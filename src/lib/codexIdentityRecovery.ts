import { invoke } from "@tauri-apps/api/core";
import type { Session } from "./session";

type RecoveryInput = {
  providerSessionId: string;
  turns: { blockId: string; startedAt: number }[];
};
export type CodexIdentityRecoveryResult = {
  status:
    | "complete"
    | "not-found"
    | "ambiguous"
    | "limit"
    | "incomplete"
    | "unavailable";
  matches: {
    blockId: string;
    providerSessionId: string;
    providerTurnId: string;
    model: string;
    providerStartedAt: number;
    source: "codex-rollout-time-match";
  }[];
};

export function legacyCodexRecoveryInput(
  session: Session,
): RecoveryInput | undefined {
  if (
    session.harness !== "codex" ||
    session.busy ||
    session.pendingSwitch ||
    !session.providerSessionId ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
      session.providerSessionId,
    ) ||
    session.blocks.some((block) => block.role === "handoff" || block.handoff) ||
    !session.blocks.some(
      (block) =>
        block.role === "user" &&
        !block.turnIdentity &&
        Number.isFinite(block.startedAt),
    )
  )
    return;
  return {
    providerSessionId: session.providerSessionId,
    // Include identified blocks too, so a recovered start cannot collide with one.
    turns: session.blocks.flatMap((block) =>
      block.role === "user" && Number.isFinite(block.startedAt)
        ? [{ blockId: block.id, startedAt: block.startedAt! }]
        : [],
    ),
  };
}

// Share only pending reads. Reopening a session can retry missing or incomplete logs.
const pending = new Map<string, Promise<CodexIdentityRecoveryResult>>();
export function recoverLegacyCodexIdentity(
  input: RecoveryInput,
): Promise<CodexIdentityRecoveryResult> {
  const key = JSON.stringify(input);
  const existing = pending.get(key);
  if (existing) return existing;
  const result = invoke<CodexIdentityRecoveryResult>(
    "recover_codex_turn_identities",
    { input },
  ).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}

export function applyLegacyCodexIdentity(
  current: Session,
  snapshot: Session,
  result: CodexIdentityRecoveryResult,
): Session {
  // Object identity is the session revision: any send, edit, switch or restore invalidates this read.
  if (
    current !== snapshot ||
    !legacyCodexRecoveryInput(current) ||
    result.status !== "complete"
  )
    return current;
  const matches = new Map(
    result.matches.map((match) => [match.blockId, match]),
  );
  if (matches.size !== result.matches.length) return current;
  let changed = false;
  const blocks = current.blocks.map((block) => {
    const match = matches.get(block.id);
    if (
      block.role !== "user" ||
      block.turnIdentity ||
      !match ||
      match.providerSessionId !== current.providerSessionId ||
      match.source !== "codex-rollout-time-match" ||
      !match.model.trim() ||
      !match.providerTurnId ||
      !Number.isFinite(block.startedAt) ||
      !Number.isFinite(match.providerStartedAt) ||
      match.providerStartedAt < block.startedAt! ||
      match.providerStartedAt - block.startedAt! > 2000
    )
      return block;
    changed = true;
    return {
      ...block,
      turnIdentity: {
        id: `recovered:${block.id}`,
        harness: "codex" as const,
        providerModel: `codex:${match.model}`,
        providerTurnId: match.providerTurnId,
        providerSessionId: match.providerSessionId,
        recovery: {
          source: match.source,
          providerSessionId: match.providerSessionId,
          providerStartedAt: match.providerStartedAt,
        },
      },
    };
  });
  return changed ? { ...current, blocks } : current;
}
