// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { InboxView } from "./InboxView";
import { clearInboxCache } from "../lib/githubTasks";
import type { LinkedWorkItem } from "../lib/session";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));
let root: Root;
let container: HTMLDivElement;
let lookupError: string | null;
const first: LinkedWorkItem = {
  kind: "issue",
  repo: "acme/first",
  number: 42,
  url: "https://github.com/acme/first/issues/42",
};
const second: LinkedWorkItem = {
  ...first,
  repo: "acme/second",
  url: "https://github.com/acme/second/issues/42",
};
const openSession = vi.fn();
const props: ComponentProps<typeof InboxView> = {
  cwd: "/tmp/checkout",
  recents: [],
  onAsk: async () => "temporary",
  onAskRestart: async () => "temporary",
  onAskMount: () => {},
  onOpenSession: openSession,
  sessions: [
    {
      id: "saved-thread",
      cwd: "/tmp/another-checkout",
      harness: "omp",
      model: "model",
      runtimeMode: "supervised",
      title: "Investigate linked issue",
      createdAt: 1,
      updatedAt: 2,
      archived: true,
      linkedWorkItem: first,
    },
  ],
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  clearInboxCache();
  lookupError = null;
  openSession.mockReset();
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, rawArgs) => {
      const repo =
        rawArgs && typeof rawArgs === "object" && "repo" in rawArgs
          ? rawArgs.repo
          : undefined;
      if (command === "linear_status") return { connected: false };
      if (command === "git_github_repo") return "acme/checkout";
      if (command === "git_github_work_item") {
        if (lookupError) throw new Error(lookupError);
        return {
          kind: "issue",
          repo,
          number: 42,
          title: `Issue in ${repo}`,
          url: `https://github.com/${repo}/issues/42`,
          state: "CLOSED",
          updatedAt: "2026-09-09T10:00:00Z",
          labels: [],
          assignees: [],
          draft: false,
        };
      }
      if (command === "git_github_work_item_details")
        return { body: `Description from ${repo}`, author: "author" };
      if (command === "git_github_work_item_thread")
        return {
          comments: [],
          truncated: false,
          reviewDecision: "",
          baseRefName: "",
          headRefName: "",
        };
      return [];
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearInboxCache();
  localStorage.clear();
});

it("reveals a filtered linked issue, opens its archived thread, and retargets the mounted Inbox across repos", async () => {
  await act(async () =>
    root.render(createElement(InboxView, { ...props, target: first })),
  );
  expect(container.textContent).toContain("Description from acme/first");
  const thread = container.querySelector<HTMLButtonElement>(
    'button[title="Open thread: Investigate linked issue"]',
  );
  expect(thread?.textContent).toContain("Archived");
  await act(async () => thread!.click());
  expect(openSession).toHaveBeenCalledExactlyOnceWith("saved-thread");

  await act(async () =>
    root.render(createElement(InboxView, { ...props, target: second })),
  );
  expect(container.textContent).toContain("Description from acme/second");
  expect(container.textContent).not.toContain("Description from acme/first");
  expect(
    container.querySelector(
      'button[title="Open thread: Investigate linked issue"]',
    ),
  ).toBeNull();
});

it("reports a failed exact lookup and lets Refresh retry the requested item", async () => {
  lookupError = "GitHub access denied";
  await act(async () =>
    root.render(createElement(InboxView, { ...props, target: first })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "GitHub access denied",
  );
  lookupError = null;
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!
      .click(),
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Description from acme/first");
});
