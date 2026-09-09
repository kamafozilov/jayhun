import { describe, expect, it } from "vitest";
import { codexQuestions, codexQuestionResponse } from "./codexQuestions";
import { CUSTOM_OPTION_ID, buildQuestionReply } from "../userQuestion";

const params = {
  questions: [
    {
      id: "scope",
      header: "Scope",
      question: "Which scope?",
      isOther: true,
      options: [{ label: "Small", description: "One module" }],
    },
    { id: "notes", header: "Notes", question: "Any notes?", options: null },
  ],
};

describe("Codex user input", () => {
  it("preserves IDs, descriptions and maps selections and free text to the wire", () => {
    const questions = codexQuestions(params);
    expect(questions[0]).toMatchObject({
      id: "scope",
      allowCustom: true,
      options: [{ id: "Small", label: "Small", description: "One module" }],
    });
    expect(
      codexQuestionResponse(
        questions,
        buildQuestionReply(
          questions,
          { scope: ["Small"] },
          { notes: "Keep compatibility" },
        ),
      ),
    ).toEqual({
      answers: {
        scope: { answers: ["Small"] },
        notes: { answers: ["Keep compatibility"] },
      },
    });
  });

  it("sends custom text instead of the synthetic Other option", () => {
    const questions = codexQuestions(params);
    expect(
      codexQuestionResponse(
        questions,
        buildQuestionReply(
          questions,
          { scope: [CUSTOM_OPTION_ID] },
          { scope: "Only the adapter" },
        ),
      ),
    ).toEqual({
      answers: { scope: { answers: ["Only the adapter"] } },
    });
  });

  it("omits skipped questions and returns an empty map only for an explicit skip", () => {
    const questions = codexQuestions(params);
    expect(codexQuestionResponse(questions, { kind: "skipped" })).toEqual({
      answers: {},
    });
    expect(
      codexQuestionResponse(questions, {
        kind: "answered",
        answers: { scope: ["Small"] },
      }),
    ).toEqual({ answers: { scope: { answers: ["Small"] } } });
  });

  it("honors disabled Other and masks secret free-text questions", () => {
    const questions = codexQuestions({
      questions: [
        { ...params.questions[0], isOther: false },
        { ...params.questions[1], isOther: false, isSecret: true },
      ],
    });
    expect(questions[0].allowCustom).toBe(false);
    expect(questions[1]).toMatchObject({ allowCustom: true, secret: true });
  });

  it.each([
    {},
    { questions: [] },
    { questions: [null] },
    { questions: [{ question: "Missing ID" }] },
    { questions: [params.questions[0], params.questions[0]] },
  ])("rejects malformed requests instead of renaming wire IDs", (input) => {
    expect(codexQuestions(input)).toEqual([]);
  });
});
