import { afterEach, expect, it, vi } from "vitest";
import {
  appendUser,
  appendSteerUser,
  applyHarnessEvent,
  stopStreaming,
} from "./harness/apply";
import { newSession } from "./session";
import {
  activeTurnIdentity,
  requestedTurnIdentity,
  turnModelName,
} from "./turnIdentity";
import { resetHarnessModelOverlays, setHarnessModels } from "./models";
import { sanitizeSessionForPersist, getSession } from "./sessionStore";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
} from "./workspaceSnapshot";
import { newTab } from "./layout";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
afterEach(() => {
  resetHarnessModelOverlays();
  mocks.invoke.mockReset();
});

it("keeps dispatch identity through selection changes, steering, cancellation, and handoff", () => {
  let session = newSession("codex", "/tmp", "codex:gpt-5.6-sol");
  session.modelSettings = { reasoningEffort: "high" };
  const identity = requestedTurnIdentity(session);
  session = appendUser(session, "First", [], { turnIdentity: identity });
  session = {
    ...session,
    model: "codex:gpt-6-astra",
    modelSettings: { reasoningEffort: "low" },
  };
  session = applyHarnessEvent(session, {
    type: "message.delta",
    text: "Working",
  });
  session = appendSteerUser(session, "Follow up");
  expect(session.blocks.at(-1)?.turnIdentity).toEqual(identity);
  expect(activeTurnIdentity(session)).toEqual(identity);
  expect(identity.modelSettings).toEqual({ reasoningEffort: "high" });
  session = stopStreaming(session);
  session = appendUser(
    { ...session, harness: "claude", model: "claude:sonnet-5" },
    "Next",
  );
  expect(session.blocks[0].turnIdentity).toEqual(identity);
  expect(session.blocks.at(-1)?.turnIdentity).toMatchObject({
    harness: "claude",
    requestedModel: "claude:sonnet-5",
  });
});

it("binds provider evidence to its dispatch without relabelling other turns", () => {
  let session = appendUser(newSession("codex", "/tmp", "codex:sol"), "First");
  const first = activeTurnIdentity(session)!;
  session = appendSteerUser(session, "More");
  session = appendUser(
    stopStreaming({ ...session, model: "codex:astra" }),
    "Second",
  );
  session = applyHarnessEvent(session, {
    type: "turn.identity",
    turnId: first.id,
    providerTurnId: "provider-1",
    providerModel: "codex:confirmed-sol",
  });
  expect(session.blocks[0].turnIdentity).toMatchObject({
    requestedModel: "codex:sol",
    providerModel: "codex:confirmed-sol",
    providerTurnId: "provider-1",
  });
  expect(session.blocks[1].turnIdentity).toEqual(
    session.blocks[0].turnIdentity,
  );
  expect(activeTurnIdentity(session)?.providerModel).toBeUndefined();
  expect(turnModelName(session.blocks[0].turnIdentity)).toBe(
    "codex:confirmed-sol",
  );
  const unchanged = applyHarnessEvent(session, {
    type: "turn.identity",
    turnId: first.id,
    providerModel: "codex:other",
  });
  expect(unchanged.blocks[0].turnIdentity).toEqual(
    session.blocks[0].turnIdentity,
  );
});

it("round-trips mixed-model history and unknown legacy turns through the real loader", async () => {
  let session = appendUser(newSession("codex", "/tmp", "codex:sol"), "First");
  session = appendUser(
    stopStreaming({ ...session, model: "codex:astra" }),
    "Second",
  );
  session.blocks.unshift({ id: "legacy", role: "user", text: "Old" });
  session = applyHarnessEvent(session, {
    type: "turn.identity",
    turnId: session.blocks[1].turnIdentity!.id,
    providerTurnId: "turn-1",
  });
  const payload = sanitizeSessionForPersist(session);
  mocks.invoke.mockResolvedValue(JSON.parse(JSON.stringify(payload)));
  const restored = await getSession(session.id);
  expect(restored?.blocks.map((block) => block.turnIdentity)).toEqual(
    payload.blocks.map((block) => block.turnIdentity),
  );
  expect(restored?.model).toBe("codex:astra");
  expect(restored?.busy).toBe(false);
  expect(turnModelName(restored?.blocks[0].turnIdentity)).toBe("Unknown model");
});

it("restores exact stub selections and settings before and after catalog discovery", () => {
  const session = newSession("codex", "/tmp", "codex:removed");
  session.modelSettings = { reasoningEffort: "high" };
  const snapshot = collectWorkspaceSnapshot(
    [newTab(session.id)],
    [session],
    "tab",
    "/tmp",
  );
  for (const discovered of [false, true]) {
    if (discovered)
      setHarnessModels("codex", [
        { id: "codex:replacement", harness: "codex", name: "Replacement" },
      ]);
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map())?.sessions[0];
    expect(restored?.model).toBe("codex:removed");
    expect(restored?.modelSettings).toEqual({ reasoningEffort: "high" });
  }
});

it("labels raw provider model IDs by exact native identity without rewriting evidence", () => {
  const identity = {
    id: "confirmed",
    harness: "codex" as const,
    providerModel: "gpt-5.6-sol",
  };
  expect(turnModelName(identity)).toBe("gpt-5.6-sol");
  setHarnessModels("codex", [
    {
      id: "codex:gpt-5.6-sol",
      nativeId: "gpt-5.6-sol",
      harness: "codex",
      name: "GPT-5.6-Sol",
    },
  ]);
  expect(turnModelName(identity)).toBe("GPT-5.6-Sol");
  expect(identity.providerModel).toBe("gpt-5.6-sol");
  expect(turnModelName({ ...identity, providerModel: "gpt-5.6" })).toBe(
    "gpt-5.6",
  );
  expect(
    turnModelName({ ...identity, providerModel: "claude:gpt-5.6-sol" }),
  ).toBe("claude:gpt-5.6-sol");
});
