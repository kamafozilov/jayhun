import { useState } from "react";
import {
  CUSTOM_OPTION_ID,
  buildQuestionReply,
  isCustomSelection,
  questionIsComplete,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../lib/userQuestion";

type Answers = Record<string, string[]>;
type Custom = Record<string, string>;

/** Keep question answers separate from the message draft and its attachments. */
export function useQuestionAnswer(
  prompt: UserQuestionPrompt | undefined,
  onReply: ((requestId: number, reply: UserQuestionReply) => void) | undefined,
) {
  const [state, setState] = useState(() => ({
    requestId: prompt?.requestId,
    step: 0,
    answers: {} as Answers,
    custom: {} as Custom,
  }));
  if (state.requestId !== prompt?.requestId) {
    setState({
      requestId: prompt?.requestId,
      step: 0,
      answers: {},
      custom: {},
    });
  }
  const question = prompt?.questions[state.step];
  const last = state.step === (prompt?.questions.length ?? 0) - 1;

  const advance = (answers: Answers, custom: Custom) => {
    if (!prompt || !question || !onReply) return;
    setState({
      ...state,
      answers,
      custom,
      step: last ? state.step : state.step + 1,
    });
    if (last)
      onReply(
        prompt.requestId,
        buildQuestionReply(prompt.questions, answers, custom),
      );
  };

  return {
    question,
    step: state.step,
    total: prompt?.questions.length ?? 0,
    last,
    text: question ? (state.custom[question.id] ?? "") : "",
    selected: question ? (state.answers[question.id] ?? []) : [],
    ready:
      !!question && questionIsComplete(question, state.answers, state.custom),
    select(optionId: string) {
      if (!question) return;
      const selected = state.answers[question.id] ?? [];
      const answers = {
        ...state.answers,
        [question.id]: question.multiSelect
          ? selected.includes(optionId)
            ? selected.filter((id) => id !== optionId)
            : [...selected, optionId]
          : [optionId],
      };
      const custom = { ...state.custom };
      if (question.multiSelect) {
        setState({ ...state, answers });
      } else {
        delete custom[question.id];
        advance(answers, custom);
      }
    },
    setText(text: string) {
      if (!question?.allowCustom) return;
      const selected = question.multiSelect
        ? (state.answers[question.id] ?? []).filter(
            (id) => !isCustomSelection(question, id),
          )
        : [];
      setState({
        ...state,
        answers: {
          ...state.answers,
          [question.id]: text.trim()
            ? [...selected, CUSTOM_OPTION_ID]
            : selected,
        },
        custom: { ...state.custom, [question.id]: text },
      });
    },
    submit() {
      if (
        question &&
        questionIsComplete(question, state.answers, state.custom)
      ) {
        advance(state.answers, state.custom);
      }
    },
    skip() {
      if (!question) return;
      const answers = { ...state.answers };
      const custom = { ...state.custom };
      delete answers[question.id];
      delete custom[question.id];
      advance(answers, custom);
    },
  };
}

export type QuestionAnswer = ReturnType<typeof useQuestionAnswer>;
