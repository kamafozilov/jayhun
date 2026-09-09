import {
  questionsFromUnknown,
  selectedAnswerLabels,
  type UserQuestion,
  type UserQuestionReply,
} from "../userQuestion";
import { asRecord } from "./codexProtocol";

/** Preserve Codex question IDs and its explicit free-text/secret flags. */
export function codexQuestions(params: unknown): UserQuestion[] {
  const raw = asRecord(params)?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const ids = new Set<string>();
  const normalized: Record<string, unknown>[] = [];
  for (const item of raw) {
    const question = asRecord(item);
    if (
      !question ||
      typeof question.id !== "string" ||
      !question.id.trim() ||
      ids.has(question.id) ||
      typeof question.question !== "string" ||
      !question.question.trim()
    )
      return [];
    ids.add(question.id);
    normalized.push({
      ...question,
      // A question without options is a free-text question.
      allowCustom:
        !Array.isArray(question.options) ||
        question.options.length === 0 ||
        question.isOther !== false,
    });
  }
  return questionsFromUnknown(normalized).map((question, index) => ({
    ...question,
    id: normalized[index].id as string,
    ...(normalized[index].isSecret === true ? { secret: true } : {}),
  }));
}

export function codexQuestionResponse(
  questions: UserQuestion[],
  reply: UserQuestionReply,
): { answers: Record<string, { answers: string[] }> } {
  if (reply.kind === "skipped") return { answers: {} };
  return {
    answers: Object.fromEntries(
      questions.flatMap((question) => {
        const answers = selectedAnswerLabels(question, reply);
        return answers.length ? [[question.id, { answers }]] : [];
      }),
    ),
  };
}
