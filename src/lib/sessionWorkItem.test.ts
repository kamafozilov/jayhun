import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  githubWorkItem,
  inboxItemKey,
  type GithubWorkItem,
  type InboxItem,
} from "./githubTasks";
import {
  inboxItemMatchesLinkedWorkItem,
  linkedWorkItemInboxKey,
  linkedWorkItemFromInboxItem,
  parseGithubWorkItemUrl,
  relatedSessionsForInboxItem,
  resolveLinkedWorkItem,
} from "./sessionWorkItem";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  clearInboxCache();
  vi.mocked(invoke).mockReset();
});

describe("session work items", () => {
  it("parses a GitHub pull request URL without repository lookup", () => {
    expect(
      parseGithubWorkItemUrl(
        "Please review https://github.com/openai/codex/pull/321?diff=split",
      ),
    ).toEqual({
      kind: "pr",
      repo: "openai/codex",
      number: 321,
      url: "https://github.com/openai/codex/pull/321",
    });
  });

  it("rejects ambiguous URLs but accepts repeated references to one item", () => {
    expect(
      parseGithubWorkItemUrl(
        "Compare https://github.com/acme/app/pull/42 and https://github.com/other/app/pull/42",
      ),
    ).toBeNull();
    expect(
      parseGithubWorkItemUrl(
        "Review PR #42: https://github.com/acme/app/pull/42/files",
      ),
    ).toEqual({
      kind: "pr",
      repo: "acme/app",
      number: 42,
      url: "https://github.com/acme/app/pull/42",
    });
  });

  it.each([
    "https://github.com.evil.test/acme/app/pull/42",
    "https://evil.test/https://github.com/acme/app/pull/42",
    "https://github.com@evil.test/acme/app/pull/42",
    "https://github.com/acme/app/pull/42.5",
    "https://github.com/acme/app/pull/42-suffix",
    "https://github.com/acme/app/pull/9007199254740993",
  ])("does not reinterpret an invalid work item URL: %s", (url) => {
    expect(parseGithubWorkItemUrl(url)).toBeNull();
  });

  it("creates a stable link from a GitHub Inbox item", () => {
    const item = {
      provider: "github",
      kind: "issue",
      repo: "openai/codex",
      number: 12,
      url: "https://github.com/openai/codex/issues/12",
    } as InboxItem;
    const linked = linkedWorkItemFromInboxItem(item);
    expect(linked).toEqual({
      kind: "issue",
      repo: "openai/codex",
      number: 12,
      url: "https://github.com/openai/codex/issues/12",
    });
    expect(inboxItemMatchesLinkedWorkItem(item, linked!)).toBe(true);
    expect(linkedWorkItemInboxKey(linked!)).toBe(inboxItemKey(item));
  });

  it("resolves an explicit PR number against the session repository", async () => {
    vi.mocked(invoke).mockResolvedValue("openai/codex");

    await expect(
      resolveLinkedWorkItem("Please fix PR #42", "/tmp/codex", null),
    ).resolves.toEqual({
      kind: "pr",
      repo: "openai/codex",
      number: 42,
      url: "https://github.com/openai/codex/pull/42",
    });
    expect(invoke).toHaveBeenCalledWith("git_github_repo", {
      cwd: "/tmp/codex",
    });
  });

  it("resolves repository-qualified references without using the local repository", async () => {
    await expect(
      resolveLinkedWorkItem("Fix issue other/project#42", "/tmp/codex", null),
    ).resolves.toEqual({
      kind: "issue",
      repo: "other/project",
      number: 42,
      url: "https://github.com/other/project/issues/42",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    "Compare PR #42 and issue #43",
    "Compare PR #42 and PR #43",
    "Fix PR #42.5",
    "Fix PR #42abc",
    "Fix PR #-42",
    "Fix PR #9007199254740993",
    "Use 42 workers",
    "Review https://example.com/items/42",
  ])(
    "does not let a generated hint override unsafe context: %s",
    async (message) => {
      await expect(
        resolveLinkedWorkItem(message, "/tmp/codex", {
          kind: "pr",
          number: 42,
        }),
      ).resolves.toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("requires a matching generated kind for an untyped numbered reference", async () => {
    vi.mocked(invoke).mockResolvedValue("openai/codex");
    await expect(
      resolveLinkedWorkItem("Fix #42", "/tmp/codex", null),
    ).resolves.toBeNull();
    await expect(
      resolveLinkedWorkItem("Fix #42", "/tmp/codex", {
        kind: "issue",
        number: 43,
      }),
    ).resolves.toBeNull();
    await expect(
      resolveLinkedWorkItem("Fix #42", "/tmp/codex", {
        kind: "issue",
        number: 42,
      }),
    ).resolves.toEqual({
      kind: "issue",
      repo: "openai/codex",
      number: 42,
      url: "https://github.com/openai/codex/issues/42",
    });
  });

  it("resolves the current PR from its authoritative URL with no title hint", async () => {
    vi.mocked(invoke).mockResolvedValue({
      number: 42,
      url: "https://github.com/upstream/project/pull/42",
    });
    await expect(
      resolveLinkedWorkItem("Review this PR", "/tmp/fork", null),
    ).resolves.toEqual({
      kind: "pr",
      repo: "upstream/project",
      number: 42,
      url: "https://github.com/upstream/project/pull/42",
    });
  });

  it("uses the local repository only when current PR status has no URL", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ number: 42, url: "" })
      .mockResolvedValueOnce("acme/project");
    await expect(
      resolveLinkedWorkItem("Review the current PR", "/tmp/project", null),
    ).resolves.toEqual({
      kind: "pr",
      repo: "acme/project",
      number: 42,
      url: "https://github.com/acme/project/pull/42",
    });
  });

  it.each([
    "https://github.com/acme/project/pull/43",
    "https://github.com/acme/project/issues/42",
    "https://example.com/acme/project/pull/42",
  ])("rejects current PR status with an inconsistent URL: %s", async (url) => {
    vi.mocked(invoke).mockResolvedValue({ number: 42, url });
    await expect(
      resolveLinkedWorkItem("Review the current PR", "/tmp/project", null),
    ).resolves.toBeNull();
  });

  it("returns no link when repository lookup fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("No GitHub remote"));
    await expect(
      resolveLinkedWorkItem("Fix issue #42", "/tmp/project", null),
    ).resolves.toBeNull();
  });

  it("fetches an exact cache miss once and reuses that result", async () => {
    const result: GithubWorkItem = {
      kind: "pr",
      repo: "openai/codex",
      number: 42,
      title: "Faster linked navigation",
      url: "https://github.com/openai/codex/pull/42",
      state: "open",
      updatedAt: "2026-09-09T12:00:00Z",
      labels: [],
      assignees: [],
      draft: false,
    };
    vi.mocked(invoke).mockResolvedValue(result);

    await expect(
      githubWorkItem("/tmp/codex", "openai/codex", "pr", 42),
    ).resolves.toEqual(result);
    await expect(
      githubWorkItem("/tmp/codex", "openai/codex", "pr", 42),
    ).resolves.toEqual(result);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("git_github_work_item", {
      cwd: "/tmp/codex",
      repo: "openai/codex",
      kind: "pr",
      number: 42,
    });
  });

  it("does not associate a Linear Inbox item", () => {
    expect(
      linkedWorkItemFromInboxItem({
        provider: "linear",
        kind: "linear",
        number: 12,
        repo: "",
      } as InboxItem),
    ).toBeNull();
  });

  it("finds sessions related to the same GitHub Inbox item", () => {
    const item = {
      provider: "github",
      kind: "pr",
      repo: "Acme/App",
      number: 42,
    } as InboxItem;
    const matching = {
      id: "matching",
      linkedWorkItem: {
        kind: "pr" as const,
        repo: "acme/app",
        number: 42,
        url: "https://github.com/acme/app/pull/42",
      },
    };
    const sessions = [
      matching,
      {
        id: "other-number",
        linkedWorkItem: { ...matching.linkedWorkItem, number: 43 },
      },
      {
        id: "other-kind",
        linkedWorkItem: {
          ...matching.linkedWorkItem,
          kind: "issue" as const,
        },
      },
      { id: "unlinked" },
    ];

    expect(relatedSessionsForInboxItem(item, sessions)).toEqual([matching]);
    expect(
      relatedSessionsForInboxItem(
        { ...item, provider: "linear", kind: "linear" } as InboxItem,
        sessions,
      ),
    ).toEqual([]);
  });
});
