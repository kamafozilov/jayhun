// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  closeLeaf,
  newFileTab,
  newTab,
  openEditorTab,
  type WorkspaceTab,
} from "../lib/layout";
import { newSession, type Session } from "../lib/session";
import { saveWorkspaceSnapshot } from "../lib/sessionStore";
import {
  hydrateWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../lib/workspaceSnapshot";
import { useWorkspacePersistence } from "./useWorkspacePersistence";

vi.mock("../lib/sessionStore", () => ({ saveWorkspaceSnapshot: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let session: Session;
let tab: WorkspaceTab;
let saved: WorkspaceSnapshot | undefined;

function Harness({
  tabs,
  sessions,
  transferring = false,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  transferring?: boolean;
}) {
  useWorkspacePersistence(
    tabs,
    sessions,
    tabs[0].id,
    "/tmp/project",
    [],
    transferring,
  );
  return null;
}

async function render(transferring = false, strict = false) {
  const element = createElement(Harness, {
    tabs: [tab],
    sessions: [session],
    transferring,
  });
  await act(async () =>
    root.render(strict ? createElement(StrictMode, null, element) : element),
  );
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  saved = undefined;
  vi.mocked(saveWorkspaceSnapshot)
    .mockReset()
    .mockImplementation(async (snapshot) => {
      saved = structuredClone(snapshot) as WorkspaceSnapshot;
    });
  session = newSession("codex", "/tmp/project");
  tab = openEditorTab(
    newTab(session.id),
    newFileTab("/tmp/project/test.ts", "/tmp/project"),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it("keeps a closed file closed after chat updates and workspace restoration", async () => {
  await render();
  await advance(250);
  expect(saved?.tabs[0].editorPanes).toHaveLength(1);
  tab = { ...closeLeaf(tab, tab.editorPanes[0].id)!, editorPanes: [] };
  await render();
  await advance(100);
  session = {
    ...session,
    busy: true,
    blocks: [{ id: "reply", role: "assistant", text: "Working" }],
  };
  await render();
  await advance(150);
  expect(
    hydrateWorkspaceSnapshot(saved!, new Map())?.tabs[0].editorPanes,
  ).toEqual([]);
  session = { ...session, busy: false };
  await render();
  await advance(500);
  expect(saveWorkspaceSnapshot).toHaveBeenCalledTimes(2);
});

it("saves on mount under StrictMode", async () => {
  await render(false, true);
  await advance(250);
  expect(saved?.tabs[0].editorPanes).toHaveLength(1);
});

it("debounces layout changes and saves the latest layout", async () => {
  await render();
  await advance(100);
  tab = { ...closeLeaf(tab, tab.editorPanes[0].id)!, editorPanes: [] };
  await render();
  await advance(249);
  expect(saveWorkspaceSnapshot).not.toHaveBeenCalled();
  await advance(1);
  expect(saved?.tabs[0].editorPanes).toEqual([]);
});

it("cancels saves during transfer and resumes with the same layout", async () => {
  await render();
  await advance(100);
  await render(true);
  await advance(300);
  expect(saveWorkspaceSnapshot).not.toHaveBeenCalled();
  await render();
  await advance(250);
  expect(saved?.tabs[0].editorPanes).toHaveLength(1);
});
