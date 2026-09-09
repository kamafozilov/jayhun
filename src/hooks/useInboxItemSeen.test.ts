// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import {
  isInboxEntryUnseen,
  seedInboxSeenIfNeeded,
  type InboxSeenEntry,
} from "../lib/inboxSeen";
import { setWindowFocused } from "../lib/notifications";
import { useInboxItemSeen } from "./useInboxItemSeen";

it("reads the selected PR and refreshed version only while the window is focused", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  seedInboxSeenIfNeeded([]);
  setWindowFocused(true);
  const root = createRoot(document.createElement("div"));
  function Harness({ entry }: { entry: InboxSeenEntry }) {
    useInboxItemSeen(entry);
    return null;
  }
  const entry = {
    key: "github:acme/web:pr:4",
    updatedAt: "2026-09-09T10:00:00Z",
  };
  await act(async () => root.render(createElement(Harness, { entry })));
  expect(isInboxEntryUnseen(entry)).toBe(false);
  const refreshed = { ...entry, updatedAt: "2026-09-09T11:00:00Z" };
  await act(async () =>
    root.render(createElement(Harness, { entry: refreshed })),
  );
  expect(isInboxEntryUnseen(refreshed)).toBe(false);
  await act(async () => setWindowFocused(false));
  const background = { ...entry, updatedAt: "2026-09-09T12:00:00Z" };
  await act(async () =>
    root.render(createElement(Harness, { entry: background })),
  );
  expect(isInboxEntryUnseen(background)).toBe(true);
  await act(async () => setWindowFocused(true));
  expect(isInboxEntryUnseen(background)).toBe(false);
  await act(async () => root.unmount());
});
