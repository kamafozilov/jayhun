// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Sidebar } from "./Sidebar";
import type { LinkedWorkItem } from "../lib/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

it("opens a work item independently of its session, including modifier-click to GitHub", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const linkedWorkItem: LinkedWorkItem = {
    kind: "pr",
    repo: "acme/web",
    number: 42,
    url: "https://github.com/acme/web/pull/42",
  };
  const onSelectSession = vi.fn();
  const onOpenInboxItem = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(Sidebar, {
          cwd: "/tmp",
          open: true,
          sessions: [
            {
              id: "linked-session",
              cwd: "/tmp",
              harness: "omp",
              model: "model",
              runtimeMode: "supervised",
              title: "Review checkout",
              createdAt: 1,
              updatedAt: 1,
              linkedWorkItem,
            },
          ],
          busySessionIds: new Set<string>(),
          approvalSessionIds: new Set<string>(),
          status: "idle",
          pending: false,
          onSelectSession,
          onOpenInboxItem,
          onOpenFile: () => {},
          tab: "sessions",
          onTabChange: () => {},
          filesSearchOpen: false,
          onFilesSearchOpenChange: () => {},
        }),
      ),
    );
    const link = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open PR #42"]',
    )!;
    await act(async () => link.click());
    expect(onOpenInboxItem).toHaveBeenCalledExactlyOnceWith(linkedWorkItem);
    expect(onSelectSession).not.toHaveBeenCalled();
    await act(async () =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true }),
      ),
    );
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(linkedWorkItem.url);
    expect(onOpenInboxItem).toHaveBeenCalledTimes(1);
    expect(onSelectSession).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Review checkout"]',
        )!
        .click(),
    );
    expect(onSelectSession).toHaveBeenCalledExactlyOnceWith("linked-session");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
