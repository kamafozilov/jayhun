// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import {
  codexQuestions,
  codexQuestionResponse,
} from "../lib/harness/codexQuestions";
import type { UserQuestionPrompt } from "../lib/userQuestion";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../lib/fileIndex", () => ({
  peekProjectFiles: () => [],
  loadProjectFiles: async () => [],
  subscribeProjectFiles: () => () => {},
  recentOpenedFiles: () => [],
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => [] }),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./ModelSettings", () => ({ ModelSettings: () => null }));
vi.mock("./AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

const questions = codexQuestions({
  questions: [
    {
      id: "color",
      header: "Color",
      question: "Which color?",
      isOther: true,
      options: [
        { label: "Blue", description: "Cool" },
        { label: "Red", description: "Warm" },
      ],
    },
    {
      id: "scope",
      header: "Scope",
      question: "Which scope?",
      isOther: true,
      options: [
        { label: "Small", description: "One module" },
        { label: "Large", description: "All modules" },
      ],
    },
  ],
});
let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;
async function render(question?: UserQuestionPrompt) {
  props = { ...props, question };
  await act(async () => root.render(createElement(Composer, props)));
}
function options() {
  return [
    ...container.querySelectorAll<HTMLButtonElement>("[data-question-option]"),
  ];
}
function input() {
  return container.querySelector<HTMLTextAreaElement>("textarea")!;
}
function button(label: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function type(text: string) {
  await act(async () => {
    input().value = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(
  element: HTMLElement,
  value: string,
  init: KeyboardEventInit = {},
) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    ),
  );
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    focused: true,
    harness: "codex",
    model: "codex/test",
    runtimeMode: "full-access",
    executionCwd: "/repo",
    hideTopBar: true,
    busy: true,
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
    onQuestionReply: vi.fn(),
    onStop: vi.fn(),
    onDraftChange: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("questions in the composer", () => {
  it("advances on selection and submits the final option without Continue", async () => {
    await render({ requestId: 1, questions });
    expect(
      container
        .querySelector("[data-composer-box]")
        ?.contains(container.querySelector("[data-question-form]")),
    ).toBe(true);
    expect(container.textContent).not.toContain("Other");
    expect(container.textContent).toContain("write your own answer below");
    await click(options()[0]);
    expect(container.textContent).toContain("Which scope?");
    expect(props.onQuestionReply).not.toHaveBeenCalled();
    await click(options()[1]);
    const [id, reply] = vi.mocked(props.onQuestionReply!).mock.calls[0];
    expect(id).toBe(1);
    expect(codexQuestionResponse(questions, reply)).toEqual({
      answers: { color: { answers: ["Blue"] }, scope: { answers: ["Large"] } },
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("sends a one-question selection immediately", async () => {
    await render({ requestId: 1, questions: [questions[0]] });
    await click(options()[0]);
    expect(props.onQuestionReply).toHaveBeenCalledOnce();
  });

  it("uses the existing input for a literal custom answer, preserving the normal draft", async () => {
    props.initialDraft = "Unsent message";
    await render();
    await type("My existing draft");
    await render({ requestId: 1, questions });
    expect(input().value).toBe("");
    await click(options()[0]);
    await type("/plan @literal custom answer");
    await key(input(), "Enter");
    const [, reply] = vi.mocked(props.onQuestionReply!).mock.calls[0];
    expect(
      codexQuestionResponse(questions, reply).answers.scope.answers,
    ).toEqual(["/plan @literal custom answer"]);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onDraftChange).not.toHaveBeenCalledWith(
      "/plan @literal custom answer",
    );
    await render();
    expect(input().value).toBe("My existing draft");
  });

  it("moves focus with arrows without submitting, and returns to the input with Escape", async () => {
    await render({ requestId: 1, questions });
    await act(async () => options()[0].focus());
    await key(options()[0], "ArrowDown");
    expect(document.activeElement).toBe(options()[1]);
    await key(options()[1], "ArrowDown");
    expect(document.activeElement).toBe(options()[0]);
    await key(options()[0], "ArrowUp");
    expect(document.activeElement).toBe(options()[1]);
    expect(props.onQuestionReply).not.toHaveBeenCalled();
    await key(options()[1], "Escape");
    expect(document.activeElement).toBe(input());
    await key(input(), "ArrowDown");
    expect(document.activeElement).toBe(options()[0]);
  });

  it("skips only the current question and resets answers for a new request", async () => {
    await render({ requestId: 1, questions });
    await click(button("Skip"));
    await click(options()[0]);
    expect(vi.mocked(props.onQuestionReply!).mock.calls[0][1]).toEqual({
      kind: "answered",
      answers: { scope: ["Small"] },
    });
    await render({ requestId: 2, questions });
    expect(container.textContent).toContain("Which color?");
    expect(input().value).toBe("");
    await click(button("Skip"));
    await click(button("Skip"));
    expect(props.onQuestionReply).toHaveBeenLastCalledWith(2, {
      kind: "skipped",
    });
  });

  it("keeps multi-select explicit and combines selected options with custom text", async () => {
    await render({
      requestId: 1,
      questions: [{ ...questions[0], multiSelect: true }],
    });
    await click(options()[0]);
    await click(options()[1]);
    expect(props.onQuestionReply).not.toHaveBeenCalled();
    await type("Green");
    await click(button("Send answer"));
    const [, reply] = vi.mocked(props.onQuestionReply!).mock.calls[0];
    expect(
      codexQuestionResponse(questions, reply).answers.color.answers,
    ).toEqual(["Blue", "Red", "Green"]);
  });

  it("does not submit IME confirmation, Shift+Enter, or a repeated Enter", async () => {
    await render({ requestId: 1, questions: [questions[0]] });
    await type("Custom");
    await key(input(), "Enter", { isComposing: true });
    await key(input(), "Enter", { shiftKey: true });
    await key(input(), "Enter", { repeat: true });
    expect(props.onQuestionReply).not.toHaveBeenCalled();
    await key(input(), "Enter");
    expect(props.onQuestionReply).toHaveBeenCalledOnce();
  });

  it("retains an answer for retry until the provider resolves it and keeps Stop available", async () => {
    await render({ requestId: 1, questions: [questions[0]] });
    await type("Keep this answer");
    await click(button("Send answer"));
    expect(input().value).toBe("Keep this answer");
    await click(button("Send answer"));
    expect(props.onQuestionReply).toHaveBeenCalledTimes(2);
    await click(button("Stop"));
    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it("masks secret answers and omits custom input when the provider disallows it", async () => {
    await render({
      requestId: 1,
      questions: [{ ...questions[0], options: [], secret: true }],
    });
    const secret = container.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    expect(secret.getAttribute("aria-label")).toBe("Which color?");
    expect(secret.autocomplete).toBe("off");
    expect(input()).toBeNull();
    await act(async () => {
      secret.value = "test-only-private-answer";
      secret.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("test-only-private-answer");
    await key(secret, "Enter");
    expect(props.onDraftChange).not.toHaveBeenCalledWith(
      "test-only-private-answer",
    );
    expect(vi.mocked(props.onQuestionReply!).mock.calls[0][1]).toMatchObject({
      custom: { color: "test-only-private-answer" },
    });
    vi.mocked(props.onQuestionReply!).mockClear();
    await render({
      requestId: 2,
      questions: [{ ...questions[0], allowCustom: false }],
    });
    expect(input()).toBeNull();
    expect(container.textContent).not.toContain("write your own answer below");
    await click(options()[0]);
    expect(props.onQuestionReply).toHaveBeenCalledOnce();
  });
});
