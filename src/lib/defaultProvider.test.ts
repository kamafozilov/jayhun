import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  newDefaultSession,
  newSession,
  followSessionDefaults,
  HARNESSES,
  type Session,
} from "./session";
import * as models from "./models";
import * as session from "./session";
import * as handoff from "./handoff";
import { dropContextWindow } from "./contextUsage";
import * as layout from "./layout";
import * as projects from "./recents";
import * as groups from "./workspaceTabGroups";
import { planWorkspaceTabClose } from "./workspaceTabGroups";
import { removeSessionFromWorkspace } from "./sessionWorkspaceLifecycle";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
} from "./workspaceSnapshot";

// Boundary tests execute the actual App callbacks with in-memory React state.
// Keep selection by callback name so changing a factory cannot bypass the test.
const source = ts.createSourceFile(
  "App.tsx",
  readFileSync(new URL("../App.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function callback(name: string, env: Record<string, unknown>) {
  let expression: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      expression = node;
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      expression = node.initializer.arguments[0];
    if (
      name === "removalReplacement" &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "createReplacement" &&
      node.initializer.getText(source).includes("latest?.cwd")
    )
      expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error(`Missing callback ${name}`);
  const js = ts.transpile(`const extracted = ${expression.getText(source)};`, {
    target: ts.ScriptTarget.ES2022,
  });
  return new Function(...Object.keys(env), `${js}\nreturn extracted;`)(
    ...Object.values(env),
  );
}
function workspace() {
  let sessions = [newSession("claude", "/tmp/old")];
  sessions[0].runtimeMode = "auto";
  sessions[0].blocks = [{ id: "u1", role: "user", text: "hello" }];
  let tabs = [layout.newTab(sessions[0].id)];
  const sessionsRef = { current: sessions };
  const tabsRef = { current: tabs };
  const env: Record<string, any> = {
    ...models,
    ...layout,
    ...projects,
    ...groups,
    newDefaultSession,
    newSession,
    sessionsRef,
    tabsRef,
    tabs,
    active: sessions[0],
    activeTab: tabs[0],
    activeTabIdRef: { current: tabs[0].id },
    sessionDefaults: sessions[0],
    projectCwd: "/tmp/old",
    sidebarCwd: "/tmp/old",
    tabCloseScope: "project",
    activeTabId: tabs[0].id,
    planWorkspaceTabClose,
    confirmCloseTerminal: async () => true,
    onCloseTab: vi.fn(),
    dirtyFilesRef: { current: new Set() },
    isBlankSession: (s: Session) => s.blocks.length === 0,
    isBlankWorkspaceTab: () => false,
    setSessions: (fn: any) => {
      sessions = typeof fn === "function" ? fn(sessions) : fn;
      sessionsRef.current = sessions;
    },
    setTabs: (fn: any) => {
      tabs = typeof fn === "function" ? fn(tabs) : fn;
      tabsRef.current = tabs;
    },
    setDirtyFiles: vi.fn(),
    refreshHistory: async () => {},
    persistSession: vi.fn(),
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setProjectCwd: vi.fn(),
    setRecents: vi.fn(),
    setActiveTabId: vi.fn(),
    setComposerFocused: vi.fn(),
    appendTab: vi.fn(),
    activateTab: vi.fn(),
    onCwdChange: vi.fn(),
  };
  return { env, sessions: () => sessions };
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  models.resetHarnessModelOverlays();
  models.saveLastModelChoice("codex", models.defaultModelId("codex"));
});
describe("default provider creation boundaries", () => {
  it.each(HARNESSES)("newDefaultSession honors %s", (harness) => {
    models.saveLastModelChoice(harness, models.defaultModelId(harness));
    expect(newDefaultSession().harness).toBe(harness);
  });
  it.each([
    "onNew",
    "onSplit",
    "onSelectProject",
    "onCwdChange",
    "onClearTabSession",
  ])("%s uses the Settings default for a fresh session", (name) => {
    const w = workspace();
    const args: Record<string, unknown[]> = {
      onNew: [],
      onSplit: ["horizontal"],
      onSelectProject: ["/tmp/new"],
      onCwdChange: [w.sessions()[0].id, "/tmp/new"],
      onClearTabSession: [w.env.tabs[0].id],
    };
    callback(name, w.env)(...args[name]);
    expect(w.sessions()).toHaveLength(2);
    expect(w.sessions()[1]).toMatchObject({
      harness: "codex",
      model: models.preferredModelId("codex"),
      runtimeMode: "auto",
    });
  });
});

describe("default provider boundary probes", () => {
  it("an already-created New callback reads an updated default", () => {
    const w = workspace();
    const run = callback("onNew", w.env);
    models.saveLastModelChoice("cursor", models.defaultModelId("cursor"));
    run();
    expect(w.sessions()[1].harness).toBe("cursor");
  });
  it("project creation reads the latest saved default", () => {
    const w = workspace();
    const run = callback("onSelectProject", w.env);
    models.saveLastModelChoice("cursor", models.defaultModelId("cursor"));
    run("/tmp/new");
    expect(models.defaultSessionChoice().harness).toBe("cursor");
    expect(w.sessions()[1].harness).toBe("cursor");
  });
  it("an unrelated seed cannot change the project provider", () => {
    const w = workspace();
    w.sessions()[0].harness = "cursor";
    w.sessions()[0].model = models.defaultModelId("cursor");
    callback("onSelectProject", w.env)("/tmp/new");
    expect(models.defaultSessionChoice().harness).toBe("codex");
    expect(w.sessions()[1].harness).toBe("codex");
  });
  it("restoring an untouched blank draft retains its old provider", () => {
    const draft = newSession("claude", "/tmp/old");
    const tab = layout.newTab(draft.id);
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [draft],
      tab.id,
      draft.cwd,
    );
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map());
    expect(restored?.sessions[0].harness).toBe("claude");
    expect(newDefaultSession().harness).toBe("codex");
  });
  it("a saved live-only default model survives cold startup and catalog loading", () => {
    const saved = {
      id: "claude:audit-custom-model",
      harness: "claude" as const,
      name: "Audit custom model",
    };
    models.setHarnessModels("claude", [...models.modelsFor("claude"), saved]);
    models.saveLastModelChoice("claude", saved.id);
    expect(newDefaultSession().model).toBe(saved.id);
    models.resetHarnessModelOverlays();
    const cold = newDefaultSession();
    models.setHarnessModels("claude", [...models.modelsFor("claude"), saved]);
    const refreshed = models.resolveModel(cold.harness, cold.model);
    expect(refreshed.id).toBe(saved.id);
  });
});

it("archiving the last session creates a replacement with the Settings default", () => {
  const w = workspace();
  const seed = w.sessions()[0];
  const replacement = callback("removalReplacement", {
    ...w.env,
    seed,
    open: seed,
  });
  const removed = removeSessionFromWorkspace({
    tabs: w.env.tabs,
    sessions: w.sessions(),
    sessionId: seed.id,
    activeTabId: w.env.tabs[0].id,
    scope: "project",
    createReplacement: replacement,
  });
  expect(removed.sessions).toHaveLength(1);
  expect(removed.sessions[0].harness).toBe("codex");
});

it.each([false, true])(
  "closing the final surface creates a default chat, terminal=%s",
  async (terminal) => {
    const w = workspace();
    const file = {
      id: "file",
      path: "/tmp/new/file.ts",
      cwd: "/tmp/new",
      terminal,
    };
    const tab = w.env.tabs[0];
    tab.layout = layout.leaf("pane");
    tab.focusedId = "pane";
    tab[terminal ? "terminalPanes" : "editorPanes"] = [
      { id: "pane", files: [file], activeFileId: file.id },
    ];
    w.sessions()[0].runtimeMode = "auto";
    callback("onCloseFile", w.env)("pane", file.id);
    await vi.waitFor(() => expect(w.sessions()).toHaveLength(2));
    expect(w.sessions()[1]).toMatchObject({
      harness: "codex",
      cwd: file.cwd,
      runtimeMode: "auto",
    });
  },
);

it("Inbox Ask restart uses defaults and retains the Inbox context", async () => {
  const w = workspace();
  const current = w.sessions()[0];
  current.inboxAsk = { key: "ask-context" } as Session["inboxAsk"];
  current.runtimeMode = "auto";
  const stopSessionForRemoval = vi.fn(async () => {});
  const freshId = await callback("onRestartInboxAsk", {
    ...w.env,
    onAskInboxItem: async () => current.id,
    removingSessionIds: { current: new Set() },
    stopSessionForRemoval,
    sessionChildHarnesses: () => [current.harness],
    forgetHarnessSession: vi.fn(),
    setInboxAskPortal: vi.fn(),
  })({});
  expect(freshId).not.toBe(current.id);
  expect(stopSessionForRemoval).toHaveBeenCalledWith(current.id);
  expect(w.sessions()[0]).toMatchObject({
    harness: "codex",
    cwd: current.cwd,
    runtimeMode: "auto",
    inboxAsk: current.inboxAsk,
  });
});

it("defaults retarget inherited drafts and preserve their runtime", () => {
  models.saveLastModelChoice("claude", "claude:opus-5");
  const draft = newDefaultSession("/tmp/old", "auto");
  models.saveLastModelChoice("cursor", models.defaultModelId("cursor"));
  models.setHarnessModels("claude", models.modelsFor("claude"));
  expect(followSessionDefaults(draft)).toMatchObject({
    harness: "cursor",
    id: draft.id,
    runtimeMode: "auto",
  });
  expect(newDefaultSession().harness).toBe("cursor");
});

it("opening a project without any seed still reads Settings", () => {
  const w = workspace();
  w.env.sessionsRef.current = [];
  w.env.tabsRef.current = [];
  callback("onSelectProject", w.env)("/tmp/new");
  expect(w.sessions()[1]).toMatchObject({ harness: "codex", cwd: "/tmp/new" });
});

it.each(["onModelChange", "onModelSettingsChange"])(
  "%s seals inheritance before React commits",
  (name) => {
    const w = workspace();
    const draft = w.sessions()[0];
    draft.blocks = [];
    draft.followsDefault = true;
    const env = {
      ...w.env,
      ...session,
      ...handoff,
      dropContextWindow,
      forgetHarnessSession: vi.fn(),
    };
    const withHarnessChoice = callback("withHarnessChoice", env);
    // Delay the React updater to reproduce a preference event before commit.
    const update = vi.fn();
    callback(name, { ...env, withHarnessChoice, setSessions: update })(
      draft.id,
      ...(name === "onModelChange"
        ? ["claude", "claude:opus-5"]
        : [{ effort: "high" }]),
    );
    const selected = w.env.sessionsRef.current[0];
    expect(selected.followsDefault).toBe(false);
    models.saveLastModelChoice("cursor", models.defaultModelId("cursor"));
    expect(followSessionDefaults(selected)).toBe(selected);
  },
);

it("an explicit cross-provider Build keeps its handoff and clears the old provider identity", () => {
  const w = workspace();
  const source = w.sessions()[0];
  source.providerSessionId = "claude-thread";
  source.context = { used: 12, window: 200000 };
  source.followsDefault = true;
  const env = { ...w.env, ...session, ...handoff, dropContextWindow };
  const withHarnessChoice = callback("withHarnessChoice", env);
  const build = callback("withPlanBuildTarget", { ...env, withHarnessChoice });
  models.saveLastModelChoice("cursor", models.defaultModelId("cursor"));
  const selected = build(source, { harness: "codex", model: "codex:explicit" });
  expect(selected).toMatchObject({
    harness: "codex",
    model: "codex:explicit",
    followsDefault: false,
    context: { used: 12 },
    pendingSwitch: { from: "claude", fromProviderSessionId: "claude-thread" },
  });
  expect(selected.providerSessionId).toBeUndefined();
  expect(selected.context.window).toBeUndefined();
  expect(
    build(selected, { harness: "codex", model: "codex:explicit" }),
  ).toEqual(selected);
});
