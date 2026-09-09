// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { setWindowFocused, useWindowFocused } from "./notifications";
import { nextUnseenFinishedSessions } from "./sessionDone";

it("keeps a background completion unread until the window is focused", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setWindowFocused(false);
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness({ busy }: { busy: boolean }) {
    const focused = useWindowFocused();
    const previousBusy = useRef(new Set<string>());
    const unseen = useRef(new Set<string>());
    const busyIds = new Set(busy ? ["a"] : []);
    unseen.current = nextUnseenFinishedSessions({
      previousBusyIds: previousBusy.current,
      busyIds,
      previousUnseenIds: unseen.current,
      focusedSessionId: focused ? "a" : undefined,
    });
    previousBusy.current = busyIds;
    return createElement("span", null, String(unseen.current.has("a")));
  }
  await act(async () => root.render(createElement(Harness, { busy: true })));
  await act(async () => root.render(createElement(Harness, { busy: false })));
  expect(container.textContent).toBe("true");
  await act(async () => setWindowFocused(true));
  expect(container.textContent).toBe("false");
  await act(async () => setWindowFocused(false));
  expect(container.textContent).toBe("false");
  await act(async () => root.unmount());
});

it("persists unread sessions across reload and merges other windows", async () => {
  const { loadUnseenFinishedSessions, saveUnseenFinishedSessions } =
    await import("./sessionDone");
  localStorage.clear();
  saveUnseenFinishedSessions(new Set(), new Set(["a"]));
  saveUnseenFinishedSessions(new Set(), new Set(["b"]));
  expect(loadUnseenFinishedSessions()).toEqual(new Set(["a", "b"]));
  saveUnseenFinishedSessions(new Set(["a"]), new Set());
  expect(loadUnseenFinishedSessions()).toEqual(new Set(["b"]));
  saveUnseenFinishedSessions(new Set(["b"]), new Set());
  expect(loadUnseenFinishedSessions()).toEqual(new Set());
});
