import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  clearInboxCache,
  inboxListCacheKey,
  listInboxItems,
  subscribeInboxList,
} from "./githubTasks";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./linear", () => ({ linearConnected: () => false }));
beforeEach(() => {
  clearInboxCache();
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === "git_github_repo") return "acme/web";
      return [];
    });
});
it("publishes background refreshes to the open inbox without another request", async () => {
  const listener = vi.fn();
  const unsubscribe = subscribeInboxList(listener);
  const projects = [{ path: "/tmp/web" }];
  const query = { assignedToMe: false, state: "all" as const, search: "" };
  const result = await listInboxItems(projects, query);
  expect(listener).toHaveBeenCalledExactlyOnceWith(
    inboxListCacheKey(projects, query),
    result,
  );
  await listInboxItems(projects, query);
  expect(listener).toHaveBeenCalledTimes(1);
  await listInboxItems(projects, query, { force: true });
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  await listInboxItems(projects, query, { force: true });
  expect(listener).toHaveBeenCalledTimes(2);
});
