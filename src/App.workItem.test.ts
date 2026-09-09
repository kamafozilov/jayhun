// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { SessionPane } from "./surfaces/SessionPane";
import { newSession } from "./lib/session";
import { newTab } from "./lib/layout";
import { saveLastModelChoice, resetHarnessModelOverlays } from "./lib/models";
import { registerHarness, resetHarnessIdlePark } from "./lib/harness/registry";
import { clearInboxCache } from "./lib/githubTasks";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    isFocused: async () => true,
    isMaximized: async () => false,
    onFocusChanged: async () => () => {},
    onCloseRequested: async () => () => {},
    onResized: async () => () => {},
    setTitle: async () => {},
  }),
}));
vi.mock("./lib/harness/register", () => ({
  registerBuiltinHarnesses: () => {},
}));
// Keep App's real submit handler, state, resolver, and Sidebar; the pane supplies only user input.
vi.mock("./surfaces/SessionPane", () => ({
  SessionPane: ({ session, onSubmit }: ComponentProps<typeof SessionPane>) =>
    createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => onSubmit(session.id, "PR #10 ni review qil", []) },
        "Submit PR follow-up",
      ),
      createElement(
        "button",
        { onClick: () => onSubmit(session.id, "PR #11 ni review qil", []) },
        "Submit another PR",
      ),
    ),
}));

let root: Root;
let container: HTMLDivElement;
const generatedTitle = vi.fn();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  clearInboxCache();
  resetHarnessModelOverlays();
  await saveLastModelChoice("omp", "omp:openai-codex/gpt-6-astra");
  generatedTitle
    .mockReset()
    .mockResolvedValue({ title: "Unexpected replacement", workItem: null });
  registerHarness({
    id: "omp",
    live: true,
    async sendTurn(input) {
      input.onEvent({ type: "message.delta", text: "Review request received" });
      input.onEvent({ type: "message.completed" });
    },
    async steerTurn() {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    generateTitle: generatedTitle,
  });
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "git_github_repo") return "kamafozilov/jayhun";
      if (command === "git_branches") return { current: "main", branches: [] };
      if (command === "git_info")
        return { branch: "main", repo: "jayhun", additions: 0, deletions: 0 };
      if (command === "git_sync_status") return { ahead: 0, behind: 0 };
      if (command === "linear_status") return { connected: false };
      if (
        command === "session_upsert" &&
        args &&
        typeof args === "object" &&
        "session" in args &&
        typeof args.session === "object"
      )
        return { ...args.session, createdAt: 1, updatedAt: 2 };
      return [];
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetHarnessIdlePark();
  resetHarnessModelOverlays();
  clearInboxCache();
  localStorage.clear();
});

it("links a PR mentioned after earlier conversation without renaming or rebinding the chat", async () => {
  const session = newSession(
    "omp",
    "/tmp/jayhun",
    "omp:openai-codex/gpt-6-astra",
  );
  session.title = "Projectsiz Umumiy Chatlar";
  session.blocks = [
    { id: "earlier-user", role: "user", text: "Chatlar navigatsiyasini qo‘sh" },
    { id: "earlier-reply", role: "assistant", text: "Navigatsiya qo‘shildi" },
  ];
  const tab = newTab(session.id);
  await act(async () =>
    root.render(
      createElement(App, {
        resumed: {
          sessions: [session],
          tabs: [tab],
          activeTabId: tab.id,
          projectCwd: session.cwd,
        },
      }),
    ),
  );
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent === "Submit PR follow-up")!
      .click(),
  );
  expect(
    container.querySelector('button[aria-label="Open PR #10"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('button[aria-label="Projectsiz Umumiy Chatlar"]'),
  ).not.toBeNull();
  expect(generatedTitle).not.toHaveBeenCalled();
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent === "Submit another PR")!
      .click(),
  );
  expect(
    container.querySelector('button[aria-label="Open PR #10"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('button[aria-label="Open PR #11"]'),
  ).toBeNull();
});
