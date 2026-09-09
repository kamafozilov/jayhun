// @vitest-environment happy-dom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { appendUser, stopStreaming } from "../lib/harness/apply";
import { newSession } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";
import { createRoot } from "react-dom/client";
import {
  resolveModel,
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../lib/models";
const session = stopStreaming(
  appendUser(newSession("codex", "/tmp", "codex:gpt-5.6-sol"), "Check"),
);
const blocks = [
  { ...session.blocks[0], durationMs: 19000 },
  { id: "a", role: "assistant" as const, text: "Done" },
];
afterEach(resetHarnessModelOverlays);
it("retains the saved Codex identity before catalog load", () => {
  resetHarnessModelOverlays();
  const html = renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks,
      busy: false,
      harness: "codex",
      model: "codex:gpt-5.6-sol",
    }),
  );
  expect(html.includes("Claude Sonnet 5")).toBe(false);
});
it("shows Sol when its catalog is loaded", () => {
  setHarnessModels("codex", [
    { id: "codex:gpt-5.6-sol", harness: "codex", name: "GPT-5.6-Sol" },
  ]);
  const html = renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks,
      busy: false,
      harness: "codex",
      model: "codex:gpt-5.6-sol",
    }),
  );
  expect(html).toContain("GPT-5.6-Sol");
});

it("updates a mounted transcript when the catalog arrives", async () => {
  resetHarnessModelOverlays();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        createElement(AgentTranscript, {
          blocks,
          busy: false,
          harness: "codex",
          model: "codex:gpt-5.6-sol",
        }),
      ),
    );
    await act(async () =>
      setHarnessModels("codex", [
        { id: "codex:gpt-5.6-sol", harness: "codex", name: "GPT-5.6-Sol" },
      ]),
    );
    expect(el.textContent?.includes("GPT-5.6-Sol")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});
it("does not resolve an unavailable Codex model to a different provider", () => {
  resetHarnessModelOverlays();
  expect(resolveModel("codex", "codex:gpt-5.6-sol").harness).toBe("codex");
});
it("does not substitute a removed historical model with the catalog default", () => {
  setHarnessModels("codex", [
    { id: "codex:gpt-6-astra", harness: "codex", name: "GPT-6-Astra" },
  ]);
  expect(resolveModel("codex", "codex:gpt-5.6-sol").id).toBe(
    "codex:gpt-5.6-sol",
  );
});
it("preserves the completed Sol label after selecting Astra for the next turn", () => {
  setHarnessModels("codex", [
    { id: "codex:gpt-5.6-sol", harness: "codex", name: "GPT-5.6-Sol" },
    { id: "codex:gpt-6-astra", harness: "codex", name: "GPT-6-Astra" },
  ]);
  const before = renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks,
      busy: false,
      harness: "codex",
      model: "codex:gpt-5.6-sol",
    }),
  );
  expect(before.includes("GPT-5.6-Sol")).toBe(true);
  const after = renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks,
      busy: false,
      harness: "codex",
      model: "codex:gpt-6-astra",
    }),
  );
  expect(after.includes("GPT-5.6-Sol")).toBe(true);
});

it("does not infer legacy identity from the selected model", () => {
  const legacy = blocks.map(({ turnIdentity: _, ...block }) => block);
  const html = renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks: legacy,
      busy: false,
      harness: "codex",
      model: "codex:gpt-6-astra",
    }),
  );
  expect(html).toContain("Unknown model");
  expect(html).not.toContain("GPT-6-Astra");
  expect(html).not.toContain("Claude");
});
it("keeps a busy response labelled with its dispatched model", () => {
  const html = renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks,
      busy: true,
      harness: "codex",
      model: "codex:gpt-6-astra",
    }),
  );
  expect(html).toContain("codex:gpt-5.6-sol");
  expect(html).toContain("(requested)");
  expect(html).not.toContain("gpt-6-astra");
});

it("does not invent a model for a cold Codex draft", () => {
  const draft = newSession("codex", "/tmp", "");
  expect(draft.harness).toBe("codex");
  expect(draft.model).toBe("");
  expect(resolveModel("codex").harness).toBe("codex");
});
