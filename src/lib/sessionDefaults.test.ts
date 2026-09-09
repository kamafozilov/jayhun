import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  followSessionDefaults,
  HARNESSES,
  newDefaultSession,
  newSession,
  refreshSessionModel,
  sealSessionDefaults,
  type Session,
} from "./session";
import {
  defaultModelId,
  modelsFor,
  nativeModelId,
  resetHarnessModelOverlays,
  resolveModel,
  saveLastModelChoice,
  setHarnessModels,
} from "./models";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
} from "./workspaceSnapshot";
import { newTab } from "./layout";
import { collectWindowTransfer } from "./windowTransfer";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  resetHarnessModelOverlays();
  saveLastModelChoice("claude", "claude:opus-5");
});

describe("draft inheritance", () => {
  it("preserves identity, project, runtime and composer context when following defaults", () => {
    const draft = {
      ...newDefaultSession("/tmp/project", "auto"),
      composerSeed: "draft text",
      noteCard: { id: "note" },
      inboxCard: { id: "issue" },
    } as Session;
    saveLastModelChoice("codex", "codex:saved");
    expect(followSessionDefaults(draft)).toEqual({
      ...draft,
      harness: "codex",
      model: "codex:saved",
      modelSettings: {},
      title: "codex",
    });
  });

  it.each(["explicit", "busy", "history", "provider", "pending", "queued"])(
    "does not retarget a %s session",
    (kind) => {
      let draft = newDefaultSession();
      if (kind === "explicit") draft = { ...draft, followsDefault: false };
      if (kind === "busy") draft.busy = true;
      if (kind === "history")
        draft.blocks = [{ id: "user", role: "user", text: "hello" }];
      if (kind === "provider") draft.providerSessionId = "existing";
      if (kind === "pending")
        draft.pendingSwitch = {
          from: "codex",
          fromModel: "codex:saved",
          fromSettings: {},
        };
      if (kind === "queued")
        draft.queuedMessages = [{ id: "q", text: "hello", attachments: [] }];
      saveLastModelChoice("cursor", defaultModelId("cursor"));
      expect(followSessionDefaults(draft)).toBe(draft);
    },
  );

  it("reads latest defaults at send and never revives inheritance after history clears", () => {
    const draft = newDefaultSession();
    saveLastModelChoice("codex", "codex:latest");
    const sent = sealSessionDefaults(draft);
    expect(sent).toMatchObject({
      harness: "codex",
      model: "codex:latest",
      followsDefault: false,
    });
    saveLastModelChoice("cursor", defaultModelId("cursor"));
    expect(followSessionDefaults({ ...sent, blocks: [] })).toMatchObject({
      harness: "codex",
      followsDefault: false,
    });
  });

  it.each([true, false])(
    "preserves draft provenance through snapshots and transfer, inherited=%s",
    (inherited) => {
      const draft = inherited ? newDefaultSession() : newSession("claude");
      const tab = newTab(draft.id);
      const snapshot = collectWorkspaceSnapshot(
        [tab],
        [draft],
        tab.id,
        draft.cwd,
      );
      const restored = hydrateWorkspaceSnapshot(snapshot, new Map())!
        .sessions[0];
      const transferred = collectWindowTransfer(
        [tab],
        [restored],
        [tab.id],
        tab.id,
        new Set(),
        draft.cwd,
      )!.sessions[0];
      saveLastModelChoice("cursor", defaultModelId("cursor"));
      expect(followSessionDefaults(transferred).harness).toBe(
        inherited ? "cursor" : "claude",
      );
    },
  );
});

describe("deferred model catalogs", () => {
  it.each(HARNESSES)(
    "preserves a live-only %s choice across cold boot and a delayed catalog",
    (harness) => {
      const model = {
        id: `${harness}:live-only`,
        harness,
        name: "Live only",
        settings: [
          {
            id: "effort",
            label: "Effort",
            kind: "select" as const,
            value: "high",
            options: [{ value: "high", label: "High" }],
          },
        ],
      };
      saveLastModelChoice(harness, model.id);
      const draft = newDefaultSession();
      expect(draft.model).toBe(model.id);
      expect(refreshSessionModel(draft)).toBe(draft);
      setHarnessModels(harness, [...modelsFor(harness), model]);
      expect(refreshSessionModel(draft)).toMatchObject({
        model: model.id,
        modelSettings: { effort: "high" },
      });
    },
  );

  it.each(HARNESSES)(
    "never resolves an empty %s catalog to another provider",
    (harness) => {
      const resolved = resolveModel(harness);
      expect(resolved.harness).toBe(harness);
      if (resolved.id) expect(resolved.id.startsWith(`${harness}:`)).toBe(true);
    },
  );

  it("leaves Codex CLI default empty before its first catalog", () => {
    expect(resolveModel("codex").id).toBe("");
    expect(nativeModelId(newSession("codex").model)).toBe("");
    expect(resolveModel("codex", "claude:opus-5").harness).toBe("codex");
    expect(resolveModel("codex", "claude:opus-5").id).toBe("");
  });

  it("does not replace a saved prefix match before the live catalog", () => {
    saveLastModelChoice("claude", "claude:claude-opus-5-custom");
    expect(newDefaultSession().model).toBe("claude:claude-opus-5-custom");
  });

  it("resolves a missing model only after a nonempty live catalog, without changing saved intent", () => {
    saveLastModelChoice("claude", "claude:removed");
    const draft = newDefaultSession();
    setHarnessModels("claude", []);
    expect(refreshSessionModel(draft)).toBe(draft);
    setHarnessModels("claude", modelsFor("claude"));
    expect(refreshSessionModel(draft).model).toBe("claude:sonnet-5");
    resetHarnessModelOverlays();
    expect(newDefaultSession().model).toBe("claude:removed");
  });

  it.each(["busy", "history", "provider"])(
    "does not rewrite %s sessions when a catalog arrives",
    (kind) => {
      const session = newSession("claude", "~", "claude:removed");
      if (kind === "busy") session.busy = true;
      if (kind === "history")
        session.blocks = [{ id: "u", role: "user", text: "sent" }];
      if (kind === "provider") session.providerSessionId = "existing";
      setHarnessModels("claude", modelsFor("claude"));
      expect(refreshSessionModel(session)).toBe(session);
    },
  );
});
