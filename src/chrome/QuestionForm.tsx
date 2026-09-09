import { useId, useState, type RefObject } from "react";
import { Check, MessageSquare } from "./icons";
import { isOtherOption } from "../lib/userQuestion";
import { isImeComposition } from "../lib/keyboard";
import type { QuestionAnswer } from "./useQuestionAnswer";

type Props = {
  answer: QuestionAnswer;
  optionsRef: RefObject<HTMLDivElement | null>;
  onFocusInput: () => void;
};

/** Question choices share the composer's frame and use its input for free text. */
export function QuestionForm({ answer, optionsRef, onFocusInput }: Props) {
  const [active, setActive] = useState(0);
  const titleId = useId();
  const question = answer.question;
  if (!question) return null;
  const options = question.options.filter((option) => !isOtherOption(option));

  return (
    <section
      data-question-form
      className="min-w-0 px-3 pt-3"
      aria-labelledby={titleId}
    >
      <div className="flex items-center gap-2 text-[11px] text-content/60">
        <MessageSquare
          aria-hidden
          className="size-3.5 shrink-0"
          strokeWidth={1.5}
        />
        <span className="min-w-0 flex-1 truncate">
          {question.header || "Question"}
        </span>
        {answer.total > 1 ? (
          <span className="shrink-0 tabular-nums">
            {answer.step + 1} of {answer.total}
          </span>
        ) : null}
        <button
          type="button"
          onClick={answer.skip}
          className="min-h-6 rounded px-1.5 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-content"
        >
          Skip
        </button>
      </div>
      <p
        id={titleId}
        className="mt-2 text-[13px] font-medium leading-5 text-content"
        aria-live="polite"
      >
        {question.prompt}
      </p>
      {question.multiSelect ? (
        <p className="mt-1 text-[11px] text-content/60">
          Select all that apply, then send your answer.
        </p>
      ) : null}
      {options.length ? (
        <div
          ref={optionsRef}
          role="group"
          aria-labelledby={titleId}
          className="mt-2 grid max-h-52 auto-rows-fr gap-1 overflow-y-auto overscroll-contain p-0.5 -mx-0.5"
          onKeyDown={(event) => {
            if (isImeComposition(event.nativeEvent)) return;
            if (event.repeat && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              return;
            }
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "[data-question-option]",
              ),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next: number;
            if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
            else if (event.key === "ArrowUp")
              next = (index - 1 + buttons.length) % buttons.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = buttons.length - 1;
            else if (event.key === "Escape" && question.allowCustom) {
              event.preventDefault();
              event.stopPropagation();
              onFocusInput();
              return;
            } else return;
            event.preventDefault();
            event.stopPropagation();
            buttons[next]?.focus();
          }}
        >
          {options.map((option, index) => {
            const selected = answer.selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                data-question-option
                tabIndex={index === active ? 0 : -1}
                aria-pressed={question.multiSelect ? selected : undefined}
                onFocus={() => setActive(index)}
                onClick={(event) => {
                  if (event.detail < 2) answer.select(option.id);
                }}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-start focus-visible:outline-2 focus-visible:outline-content ${selected ? "border-content/35 bg-content/10" : "border-content/10 hover:border-content/25 hover:bg-content/5"}`}
              >
                <span
                  aria-hidden
                  className={`grid size-5 shrink-0 place-items-center rounded border text-[10px] tabular-nums ${selected ? "border-content bg-content text-background-base" : "border-content/15 text-content/50"}`}
                >
                  {selected ? <Check className="size-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] leading-4 text-content">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-[11px] leading-4 text-content/60">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {question.allowCustom ? (
        <button
          type="button"
          onClick={onFocusInput}
          className="mt-2 w-full rounded py-1 text-start text-[11px] text-content/60 hover:text-content focus-visible:outline-2 focus-visible:outline-content"
        >
          {options.length
            ? "Choose an option above, or write your own answer below."
            : "Write your answer below."}
        </button>
      ) : null}
    </section>
  );
}
