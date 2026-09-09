// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { resetHarnessModelOverlays, setHarnessModels } from "../lib/models";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(resetHarnessModelOverlays);

it("refreshes the mounted session label when the model catalog arrives", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const noop = () => {};
  try {
    await act(async () =>
      root.render(
        createElement(Sidebar, {
          cwd: "/tmp",
          open: true,
          sessions: [
            {
              id: "s1",
              cwd: "/tmp",
              harness: "codex",
              model: "codex:gpt-5.6-sol",
              title: "Example",
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          busySessionIds: new Set<string>(),
          approvalSessionIds: new Set<string>(),
          status: "idle",
          pending: false,
          onSelectSession: noop,
          onOpenFile: noop,
          tab: "sessions",
          onTabChange: noop,
          filesSearchOpen: false,
          onFilesSearchOpenChange: noop,
        }),
      ),
    );
    expect(el.textContent).toContain("codex:gpt-5.6-sol");
    expect(el.textContent).not.toContain("Claude Sonnet");
    await act(async () =>
      setHarnessModels("codex", [
        { id: "codex:gpt-5.6-sol", harness: "codex", name: "GPT-5.6-Sol" },
      ]),
    );
    expect(el.textContent).toContain("GPT-5.6-Sol");
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});
