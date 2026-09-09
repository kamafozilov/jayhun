import { extractJsonObject, limitSection } from "./jsonText";

const MESSAGE_LIMIT = 8_000;
const TITLE_LIMIT = 50;

const THREAD_TITLE_PROMPT = `Generate a title that will help the user recognize this coding session weeks later.
Also identify one GitHub issue or pull request only when the user explicitly refers to it by number or URL.
Return JSON with exactly two keys: title and workItem.
workItem must be null or an object with exactly two keys: kind ("issue" or "pr") and number (a positive integer copied from the user message).
Never invent a work item number. If the reference is ambiguous or has no number, return null.
Do not call tools. Reply with JSON only.

Before answering, silently reduce the request to:
- Subject: What system, feature, or problem is this really about?
- Outcome: What does the user ultimately want to understand or change?
- Incidental instructions: What only describes how the agent should do the work?

Title the subject and outcome. Discard incidental instructions.

Editorial rules:
- 3-8 words, fewer than 40 characters.
- Use a compact noun phrase or clear action phrase.
- Capture the umbrella goal when the request lists several symptoms or steps.
- Name the product change, not the mock, plan, report, branch, or PR used to produce it.
- Models, subagents, tools, and output formats do not belong in the title unless they are themselves the topic.
- Do not claim the work is complete.
- Do not copy and truncate the user's message.
- Avoid quotes, labels, filler, and trailing punctuation.`;

export type GeneratedWorkItemHint = {
  kind: "issue" | "pr";
  number: number;
};

export type GeneratedSessionTitle = {
  title: string;
  workItem: GeneratedWorkItemHint | null;
};

export function buildThreadTitlePrompt(message: string): string {
  return `${THREAD_TITLE_PROMPT}\n\nUser message:\n${limitSection(message, MESSAGE_LIMIT)}`;
}

export function sanitizeThreadTitle(raw: string): string {
  const normalized = raw
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return "";
  if (normalized.length <= TITLE_LIMIT) return normalized;
  return `${normalized.slice(0, TITLE_LIMIT - 3).trimEnd()}...`;
}

type WorkItemReference = {
  kind: GeneratedWorkItemHint["kind"] | null;
  number: number;
  repo: string | null;
};

/**
 * Read explicit references, never arbitrary numbers from prose. Null means no
 * reference; "ambiguous" also covers malformed references that must not fall
 * back to a different item (for example the current branch's PR).
 */
export function parseWorkItemReference(
  message: string,
): WorkItemReference | "ambiguous" | null {
  const references =
    /https?:\/\/[^\s<>"'`]+|\b(pr|pull\s+request|issue)\s*(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#|#?)\s*([+-]?\d[\w.-]*)|(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\s*[+-]?\d[\w.-]*/gi;
  let result: WorkItemReference | null = null;
  for (const match of message.matchAll(references)) {
    let kind: WorkItemReference["kind"] = null;
    let repo: string | null = null;
    let numberText: string;
    if (/^https?:/i.test(match[0])) {
      let url: URL;
      try {
        url = new URL(match[0].replace(/[)\]},;.!?]+$/, ""));
      } catch {
        return "ambiguous";
      }
      if (url.hostname.toLowerCase() !== "github.com") continue;
      const path =
        /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues)(?:\/([^/]*)(?:\/.*)?)?$/i.exec(
          url.pathname,
        );
      if (!path) continue;
      if (url.username || url.password || url.port) return "ambiguous";
      repo = `${path[1]}/${path[2]}`;
      kind = path[3].toLowerCase() === "pull" ? "pr" : "issue";
      numberText = path[4] ?? "";
    } else if (match[1]) {
      kind = match[1].toLowerCase() === "issue" ? "issue" : "pr";
      repo = match[2] ?? null;
      numberText = match[3].replace(/[.]+$/, "");
    } else {
      const hash = match[0].indexOf("#");
      repo = match[0].slice(0, hash) || null;
      numberText = match[0]
        .slice(hash + 1)
        .trim()
        .replace(/[.]+$/, "");
    }
    const number = Number(numberText);
    if (
      !/^\d+$/.test(numberText) ||
      !Number.isSafeInteger(number) ||
      number <= 0
    ) {
      return "ambiguous";
    }
    if (!result) {
      result = { kind, number, repo };
      continue;
    }
    if (
      result.number !== number ||
      (result.kind && kind && result.kind !== kind) ||
      (result.repo && repo && result.repo.toLowerCase() !== repo.toLowerCase())
    ) {
      return "ambiguous";
    }
    result.kind ??= kind;
    result.repo ??= repo;
  }
  return result;
}

export function parseGeneratedSessionTitle(
  raw: string,
  message: string,
): GeneratedSessionTitle | null {
  const json = extractJsonObject(raw);
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed && typeof parsed === "object" && "title" in parsed) {
        const value = parsed.title;
        const title =
          typeof value === "string" ? sanitizeThreadTitle(value) : "";
        if (title) {
          const candidate = "workItem" in parsed ? parsed.workItem : null;
          const workItem =
            candidate && typeof candidate === "object" ? candidate : null;
          const kind = workItem && "kind" in workItem ? workItem.kind : null;
          const number =
            workItem && "number" in workItem ? workItem.number : null;
          const reference = parseWorkItemReference(message);
          const validWorkItem: GeneratedWorkItemHint | null =
            (kind === "issue" || kind === "pr") &&
            typeof number === "number" &&
            Number.isSafeInteger(number) &&
            number > 0 &&
            reference !== null &&
            reference !== "ambiguous" &&
            reference.number === number &&
            (reference.kind === null || reference.kind === kind)
              ? { kind, number }
              : null;
          return { title, workItem: validWorkItem };
        }
      }
    } catch {
      // Fall through to a bare-title parse when the model skipped JSON.
    }
  }

  const fallback = sanitizeThreadTitle(raw);
  if (!fallback || /[{}]/.test(fallback)) return null;
  const words = fallback.split(" ").filter(Boolean).length;
  if (words < 2 || words > 10) return null;
  return { title: fallback, workItem: null };
}
