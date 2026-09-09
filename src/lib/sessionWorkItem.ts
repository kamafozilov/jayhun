import { gitPrStatus } from "./fs";
import {
  githubRepo,
  inboxIdentityKey,
  type InboxItem,
  type GithubTaskKind,
} from "./githubTasks";
import type { LinkedWorkItem } from "./session";
import {
  parseWorkItemReference,
  type GeneratedWorkItemHint,
} from "./sessionTitle";

function validNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function githubUrl(repo: string, kind: GithubTaskKind, number: number): string {
  return `https://github.com/${repo}/${kind === "pr" ? "pull" : "issues"}/${number}`;
}

export function parseGithubWorkItemUrl(message: string): LinkedWorkItem | null {
  const reference = parseWorkItemReference(message);
  if (
    !reference ||
    reference === "ambiguous" ||
    !reference.repo ||
    !reference.kind
  ) {
    return null;
  }
  const { repo, kind, number } = reference;
  return { kind, repo, number, url: githubUrl(repo, kind, number) };
}

function validRepo(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

/** Resolve explicit message context to one stable GitHub identity. */
export async function resolveLinkedWorkItem(
  message: string,
  cwd: string,
  generatedHint: GeneratedWorkItemHint | null,
): Promise<LinkedWorkItem | null> {
  const reference = parseWorkItemReference(message);
  if (reference === "ambiguous") return null;
  if (reference) {
    const kind =
      reference.kind ??
      (generatedHint?.number === reference.number ? generatedHint.kind : null);
    if (kind !== "issue" && kind !== "pr") return null;
    try {
      const repo = reference.repo ?? (await githubRepo(cwd));
      if (!validRepo(repo)) return null;
      return {
        kind,
        number: reference.number,
        repo,
        url: githubUrl(repo, kind, reference.number),
      };
    } catch {
      return null;
    }
  }

  if (!/\b(?:this|the|current)\s+(?:pr|pull\s+request)\b/i.test(message)) {
    return null;
  }
  try {
    const pr = await gitPrStatus(cwd);
    if (!pr || !validNumber(pr.number)) return null;
    if (pr.url) {
      const linked = parseGithubWorkItemUrl(pr.url);
      return linked?.kind === "pr" && linked.number === pr.number
        ? linked
        : null;
    }
    const repo = await githubRepo(cwd);
    if (!validRepo(repo)) return null;
    return {
      kind: "pr",
      repo,
      number: pr.number,
      url: githubUrl(repo, "pr", pr.number),
    };
  } catch {
    return null;
  }
}

export function linkedWorkItemFromInboxItem(
  item: InboxItem,
): LinkedWorkItem | null {
  if (
    item.provider !== "github" ||
    (item.kind !== "issue" && item.kind !== "pr") ||
    !validNumber(item.number) ||
    !validRepo(item.repo)
  ) {
    return null;
  }
  return {
    kind: item.kind,
    repo: item.repo,
    number: item.number,
    url: item.url || githubUrl(item.repo, item.kind, item.number),
  };
}

export function inboxItemMatchesLinkedWorkItem(
  item: InboxItem,
  linked: LinkedWorkItem,
): boolean {
  return (
    item.provider === "github" &&
    item.kind === linked.kind &&
    item.number === linked.number &&
    item.repo.trim().toLowerCase() === linked.repo.trim().toLowerCase()
  );
}

/** Same key used by Inbox selection, without synthesizing a full Inbox item. */
export function linkedWorkItemInboxKey(linked: LinkedWorkItem): string {
  return `github:${inboxIdentityKey(linked)}`;
}

/** Find local sessions whose persisted GitHub identity matches an Inbox row. */
export function relatedSessionsForInboxItem<
  T extends { linkedWorkItem?: LinkedWorkItem },
>(item: InboxItem, sessions: readonly T[]): T[] {
  if (item.provider !== "github") return [];
  return sessions.filter(
    (session) =>
      session.linkedWorkItem != null &&
      inboxItemMatchesLinkedWorkItem(item, session.linkedWorkItem),
  );
}
