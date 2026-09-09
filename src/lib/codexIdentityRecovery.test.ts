// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyLegacyCodexIdentity,
  legacyCodexRecoveryInput,
  recoverLegacyCodexIdentity,
  type CodexIdentityRecoveryResult,
} from "./codexIdentityRecovery";
import { newSession, type Session } from "./session";
import { sanitizeSessionForPersist, getSession } from "./sessionStore";
import { useLegacyCodexIdentityRecovery } from "../hooks/useLegacyCodexIdentityRecovery";
import { AgentTranscript } from "../surfaces/AgentTranscript";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
afterEach(() => mocks.invoke.mockReset());
const providerSessionId = "01a084e3-6b4f-7350-8840-0d600d03435c";
function legacy(): Session {
  return {
    ...newSession("codex", "/tmp", "codex:next-selection"),
    providerSessionId,
    blocks: [
      {
        id: "u1",
        role: "user",
        text: "Transformed display prompt",
        startedAt: 1000,
        durationMs: 19000,
      },
      { id: "a1", role: "assistant", text: "Done" },
      { id: "steer", role: "user", text: "Follow up" },
    ],
  };
}
function evidence(): CodexIdentityRecoveryResult {
  return {
    status: "complete",
    matches: [
      {
        blockId: "u1",
        providerSessionId,
        providerTurnId: "turn-1",
        model: "gpt-5.6-sol",
        providerStartedAt: 1560,
        source: "codex-rollout-time-match",
      },
    ],
  };
}

it("recovers provider metadata without fabricating a requested model or steering identity", async () => {
  const session = legacy();
  const recovered = applyLegacyCodexIdentity(session, session, evidence());
  expect(recovered.blocks[0].turnIdentity).toMatchObject({
    harness: "codex",
    providerModel: "codex:gpt-5.6-sol",
    recovery: {
      source: "codex-rollout-time-match",
      providerSessionId,
      providerStartedAt: 1560,
    },
  });
  expect(recovered.blocks[0].turnIdentity?.requestedModel).toBeUndefined();
  expect(recovered.blocks[2].turnIdentity).toBeUndefined();
  expect(recovered.model).toBe("codex:next-selection");
  const payload = sanitizeSessionForPersist(recovered);
  mocks.invoke.mockResolvedValue(JSON.parse(JSON.stringify(payload)));
  expect((await getSession(session.id))?.blocks[0].turnIdentity).toEqual(
    recovered.blocks[0].turnIdentity,
  );
});

it("excludes active sessions and histories without an unambiguous provider segment", () => {
  const session = legacy();
  expect(legacyCodexRecoveryInput({ ...session, busy: true })).toBeUndefined();
  expect(
    legacyCodexRecoveryInput({ ...session, providerSessionId: "../wrong" }),
  ).toBeUndefined();
  expect(
    legacyCodexRecoveryInput({ ...session, harness: "claude" }),
  ).toBeUndefined();
  expect(
    legacyCodexRecoveryInput({
      ...session,
      blocks: [...session.blocks, { id: "h", role: "handoff", text: "" }],
    }),
  ).toBeUndefined();
  expect(legacyCodexRecoveryInput(session)?.turns).toEqual([
    { blockId: "u1", startedAt: 1000 },
  ]);
});

it("discards stale replies after a send, model switch, provider rebind or block edit", () => {
  const snapshot = legacy();
  for (const current of [
    { ...snapshot, busy: true },
    { ...snapshot, model: "codex:another" },
    { ...snapshot, providerSessionId: "different" },
    { ...snapshot, blocks: [...snapshot.blocks] },
  ])
    expect(applyLegacyCodexIdentity(current, snapshot, evidence())).toBe(
      current,
    );
});

it("keeps unknown identities for non-complete scans and invalid evidence", () => {
  const session = legacy();
  for (const status of [
    "not-found",
    "ambiguous",
    "limit",
    "incomplete",
    "unavailable",
  ] as const) {
    expect(
      applyLegacyCodexIdentity(session, session, { ...evidence(), status }),
    ).toBe(session);
  }
  for (const patch of [
    { providerSessionId: "wrong" },
    { model: "" },
    { providerStartedAt: 999 },
    { providerStartedAt: 3001 },
  ]) {
    const result = evidence();
    Object.assign(result.matches[0], patch);
    expect(applyLegacyCodexIdentity(session, session, result)).toBe(session);
  }
});

it("includes already identified users in collision checks without overwriting them", () => {
  const session = legacy();
  session.blocks.push({
    id: "u2",
    role: "user",
    text: "New",
    startedAt: 2000,
    turnIdentity: {
      id: "dispatch",
      harness: "codex",
      requestedModel: "codex:astra",
    },
  });
  expect(legacyCodexRecoveryInput(session)?.turns).toHaveLength(2);
  const result = evidence();
  result.matches.push({
    ...result.matches[0],
    blockId: "u2",
    providerStartedAt: 2050,
  });
  expect(applyLegacyCodexIdentity(session, session, result).blocks.at(-1)).toBe(
    session.blocks.at(-1),
  );
});

it("coalesces pending reads but retries a missing log on a later load", async () => {
  let resolve!: (result: CodexIdentityRecoveryResult) => void;
  mocks.invoke.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const input = legacyCodexRecoveryInput(legacy())!;
  const first = recoverLegacyCodexIdentity(input);
  const second = recoverLegacyCodexIdentity(input);
  expect(mocks.invoke).toHaveBeenCalledOnce();
  resolve({ status: "not-found", matches: [] });
  await Promise.all([first, second]);
  mocks.invoke.mockResolvedValue(evidence());
  await recoverLegacyCodexIdentity(input);
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it("updates a mounted restored transcript after bounded recovery completes", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  let resolve!: (result: CodexIdentityRecoveryResult) => void;
  mocks.invoke.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  function RestoredChat() {
    const [sessions, setSessions] = useState([legacy()]);
    useLegacyCodexIdentityRecovery(sessions, setSessions);
    return createElement(AgentTranscript, {
      blocks: sessions[0].blocks,
      harness: sessions[0].harness,
      model: sessions[0].model,
      busy: false,
    });
  }
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  try {
    await act(async () => root.render(createElement(RestoredChat)));
    expect(el.textContent).toContain("Unknown model");
    await act(async () => resolve(evidence()));
    expect(el.textContent).toContain("codex:gpt-5.6-sol (recovered)");
    expect(el.textContent).not.toContain("next-selection");
    expect(mocks.invoke).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});
