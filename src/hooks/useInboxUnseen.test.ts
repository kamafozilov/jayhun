// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  listInboxItems,
  inboxItemKey,
  type InboxItem,
} from "../lib/githubTasks";
import { markInboxItemSeen } from "../lib/inboxSeen";
import { resetSoundCues } from "../lib/sounds";
import { useInboxUnseen } from "./useInboxUnseen";

const { play } = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("cuelume", () => ({ play, setEnabled: vi.fn(), setVolume: vi.fn() }));
vi.mock("../lib/githubTasks", async (original) => ({
  ...(await original<typeof import("../lib/githubTasks")>()),
  listInboxItems: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
const recents: [] = [];
function Harness() {
  return createElement(
    "span",
    null,
    String(useInboxUnseen(recents, "/tmp/project")),
  );
}
function item(number: number): InboxItem {
  return {
    provider: "github",
    kind: "pr",
    number,
    repo: "acme/web",
    projectPath: "/tmp/project",
    title: "PR",
    url: "",
    state: "OPEN",
    updatedAt: "2026-09-09T10:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
  };
}
async function poll(items: InboxItem[]) {
  vi.mocked(listInboxItems).mockResolvedValue({ items, errors: {} });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  resetSoundCues();
  play.mockClear();
  vi.mocked(listInboxItems)
    .mockReset()
    .mockResolvedValue({ items: [], errors: {} });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("keeps a read PR read through polling and announces each new PR", async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(play).not.toHaveBeenCalled();
  const a = item(1);
  await poll([a]);
  expect(container.textContent).toBe("true");
  expect(play).toHaveBeenCalledTimes(1);
  await poll([a, item(2)]);
  expect(play).toHaveBeenCalledTimes(2);
  await act(async () =>
    markInboxItemSeen({ key: inboxItemKey(a), updatedAt: a.updatedAt }),
  );
  await poll([a]);
  expect(container.textContent).toBe("false");
  await poll([a]);
  expect(container.textContent).toBe("false");
  expect(play).toHaveBeenCalledTimes(2);
  await poll([{ ...a, updatedAt: "2026-09-09T11:00:00Z" }]);
  expect(container.textContent).toBe("true");
  expect(play).toHaveBeenCalledTimes(3);
});
it("does not prime from failed requests or chime for recovered existing items", async () => {
  vi.mocked(listInboxItems).mockResolvedValue({
    items: [],
    errors: { github: "offline" },
  });
  await act(async () => root.render(createElement(Harness)));
  await poll([item(1)]);
  expect(container.textContent).toBe("false");
  expect(play).not.toHaveBeenCalled();
  await poll([item(1), item(2)]);
  expect(container.textContent).toBe("true");
  expect(play).toHaveBeenCalledTimes(1);
});
it("polls while the document is hidden", async () => {
  await act(async () => root.render(createElement(Harness)));
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await poll([item(1)]);
  expect(container.textContent).toBe("true");
  expect(play).toHaveBeenCalledTimes(1);
  hidden.mockRestore();
});
