import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

function tool(id: string, approval?: Block["approval"]): Block {
  return {
    id,
    role: "tool",
    text: `Inspect hidden-detail-${id}`,
    tool: { kind: "shell", status: approval ? "pending" : "completed" },
    ...(approval ? { approval } : {}),
  };
}

function render(blocks: Block[], busy = false) {
  return renderToStaticMarkup(createElement(AgentTranscript, { blocks, busy }));
}

describe("AgentTranscript saved skills budget warnings", () => {
  const warning =
    "Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";

  it("hides repeated saved warnings without changing history", () => {
    const blocks: Block[] = [
      { id: "user1", role: "user", text: "First request" },
      { id: "warning1", role: "system", text: warning },
      { id: "answer1", role: "assistant", text: "First answer" },
      { id: "user2", role: "user", text: "Second request" },
      {
        id: "warning2",
        role: "system",
        text: `  ${warning.replaceAll(". ", ".\n")}  `,
      },
      { id: "error", role: "system", text: "Connection lost. Retrying." },
    ];
    const saved = JSON.stringify(blocks);
    for (const busy of [false, true]) {
      const markup = render(blocks, busy);
      expect(markup).not.toContain("Skill descriptions were shortened");
      expect(markup).toContain("First answer");
      expect(markup).toContain("Second request");
      expect(markup).toContain("Connection lost. Retrying.");
    }
    expect(JSON.stringify(blocks)).toBe(saved);
  });

  it("preserves user and assistant quotes and warnings with extra details", () => {
    for (const role of ["user", "assistant"] as const) {
      expect(render([{ id: role, role, text: warning }])).toContain(warning);
    }
    expect(
      render([
        {
          id: "extended",
          role: "system",
          text: `${warning} Skills failed to load.`,
        },
      ]),
    ).toContain("Skills failed to load.");
  });
});

describe("AgentTranscript collapsed work", () => {
  it("renders the summary and answer without mounting a large completed tool trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Check the project" },
      ...Array.from({ length: 1357 }, (_, index) => tool(String(index))),
      { id: "answer", role: "assistant", text: "The project checks passed." },
    ];
    const markup = render(blocks);
    expect(markup).toContain("The project checks passed.");
    expect(markup).toContain("Show the work");
    expect(markup.includes("hidden-detail-")).toBe(false);
    const short = render([blocks[0], tool("one"), tool("two"), blocks.at(-1)!]);
    const tagCount = (html: string) => html.match(/<[a-z]/g)?.length ?? 0;
    expect(tagCount(markup)).toBe(tagCount(short));
  });

  it("keeps live work visible before the assistant answers", () => {
    expect(render([tool("live")], true)).toContain("hidden-detail-live");
  });

  it("keeps an unresolved approval visible even when narration follows it", () => {
    const markup = render(
      [
        tool("approval", { requestId: 1 }),
        {
          id: "answer",
          role: "assistant",
          text: "Please approve the command.",
        },
      ],
      true,
    );
    expect(markup).toContain("hidden-detail-approval");
    expect(markup).toContain("Please approve the command.");
    expect(markup.includes('aria-label="Show the work"')).toBe(false);
  });
});
