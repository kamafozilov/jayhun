import { describe, expect, it } from "vitest";
import { parseGeneratedSessionTitle } from "./sessionTitle";

describe("session title metadata", () => {
  it("accepts a referenced PR number", () => {
    expect(
      parseGeneratedSessionTitle(
        '{"title":"Fix session links","workItem":{"kind":"pr","number":42}}',
        "Please fix PR #42",
      ),
    ).toEqual({
      title: "Fix session links",
      workItem: { kind: "pr", number: 42 },
    });
  });

  it("drops a model-invented number without losing the title", () => {
    expect(
      parseGeneratedSessionTitle(
        '{"title":"Fix session links","workItem":{"kind":"issue","number":99}}',
        "Please fix the session links",
      ),
    ).toEqual({ title: "Fix session links", workItem: null });
  });

  it.each([
    ["Use 42 workers", "pr", 42],
    ["Fix issue #42", "pr", 42],
    ["Compare PR #42 and PR #43", "pr", 42],
    ["Fix PR #42.5", "pr", 42],
    ["Fix PR #42abc", "pr", 42],
    ["Review https://example.com/issue/42", "issue", 42],
  ])("drops unsupported metadata for %s", (message, kind, number) => {
    expect(
      parseGeneratedSessionTitle(
        JSON.stringify({
          title: "Fix session links",
          workItem: { kind, number },
        }),
        message,
      ),
    ).toEqual({ title: "Fix session links", workItem: null });
  });

  it("uses the generated kind for an explicitly numbered shorthand", () => {
    expect(
      parseGeneratedSessionTitle(
        '{"title":"Fix session links","workItem":{"kind":"issue","number":42}}',
        "Please fix #42",
      ),
    ).toEqual({
      title: "Fix session links",
      workItem: { kind: "issue", number: 42 },
    });
  });

  it("rejects malformed title values rather than displaying coerced data", () => {
    expect(
      parseGeneratedSessionTitle('{"title":null}', "Fix PR #42"),
    ).toBeNull();
    expect(
      parseGeneratedSessionTitle('{"title":["Fix links"]}', ""),
    ).toBeNull();
  });

  it("preserves title normalization and non-English text", () => {
    expect(
      parseGeneratedSessionTitle('{"title":"  `Исправить   ссылки`  "}', ""),
    ).toEqual({ title: "Исправить ссылки", workItem: null });
    expect(
      parseGeneratedSessionTitle("Fix links\nExtra explanation", ""),
    ).toEqual({
      title: "Fix links",
      workItem: null,
    });
  });

  it("keeps compatibility with a bare generated title", () => {
    expect(parseGeneratedSessionTitle("Fix session links", "anything")).toEqual(
      { title: "Fix session links", workItem: null },
    );
  });
});
