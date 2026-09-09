import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let failWrite = false;
let onExit: ((code: number | null) => void) | undefined;
let onLine: ((line: string) => void) | undefined;

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (l: string) => void,
    exit: (code: number | null) => void,
  ) => {
    onLine = line;
    onExit = exit;
  },
  writeChild: async (_id: string, line: string) => {
    if (failWrite) throw new Error("write failed");
    sent.push(line);
  },
}));

const {
  cancelCodexTurn,
  respondCodexQuestion,
  compactCodexContext,
  sendCodexTurn,
  stopCodexSession,
  __codexTestReset,
} = await import("./codex");
import { applyHarnessEvent } from "./apply";
import { newSession } from "../session";
import { codexAdapter } from "./codexAdapter";
import type { HarnessEvent } from "./types";
import type { RuntimeMode, TurnIntent } from "../session";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ id, result }));
}

function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ method, params }));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.method ?? `reply:${m.id}`))}`,
  );
};

async function startTurn(
  sessionId: string,
  options: {
    runtimeMode?: RuntimeMode;
    intent?: TurnIntent;
    model?: string;
    turnId?: string;
  } = {},
) {
  const events: HarnessEvent[] = [];
  const turn = sendCodexTurn({
    sessionId,
    cwd: "/repo",
    model: options.model ?? "codex:gpt-5.4",
    turnId: options.turnId,
    modelSettings: {},
    runtimeMode: options.runtimeMode ?? "supervised",
    intent: options.intent,
    text: "summarize the changelog",
    attachments: [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () => parse().some((m) => m.method === "initialize"),
    "initialize",
  );
  reply(parse().find((m) => m.method === "initialize")!.id as number, {});
  await waitFor(
    () => parse().some((m) => m.method === "thread/start"),
    "thread/start",
  );
  reply(parse().find((m) => m.method === "thread/start")!.id as number, {
    thread: { id: "thr_1" },
  });
  await waitFor(
    () => parse().some((m) => m.method === "turn/start"),
    "turn/start",
  );
  reply(parse().find((m) => m.method === "turn/start")!.id as number, {
    turn: { id: "turn_1", status: "inProgress" },
  });
  notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
  return { events, turn };
}

function ask(
  id: string | number = "question-1",
  overrides: Record<string, unknown> = {},
) {
  onLine!(
    JSON.stringify({
      id,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "ask_1",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            isOther: true,
            options: [{ label: "Small", description: "One module" }],
          },
        ],
        ...overrides,
      },
    }),
  );
}

function pendingQuestion(events: HarnessEvent[]) {
  const session = events.reduce(
    applyHarnessEvent,
    newSession("codex", "/repo"),
  );
  return session.pendingQuestion;
}

function finish() {
  notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
}

describe("codex live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
    onExit = undefined;
    failWrite = false;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await stopCodexSession("codex-live");
    __codexTestReset();
  });

  it("waits for the user when Codex requests input", async () => {
    const { events, turn } = await startTurn("codex-live", { intent: "plan" });
    onLine!(
      JSON.stringify({
        id: "question-1",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "ask_1",
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Which scope?",
              options: [
                { label: "Small", description: "One module" },
                { label: "All", description: "All modules" },
              ],
            },
          ],
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parse().filter((message) => message.id === "question-1")).toEqual(
      [],
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "question.asked" }),
    );
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("routes an answer through the registered adapter and clears the form once", async () => {
    const { events, turn } = await startTurn("codex-live", { intent: "plan" });
    ask();
    const question = pendingQuestion(events)!;
    expect(question.questions[0].id).toBe("scope");
    codexAdapter.respondQuestion!("codex-live", question.requestId, {
      kind: "answered",
      answers: { scope: ["Small"] },
    });
    codexAdapter.respondQuestion!("codex-live", question.requestId, {
      kind: "skipped",
    });
    await waitFor(() => !pendingQuestion(events), "question cleared");
    expect(parse().filter((message) => message.id === "question-1")).toEqual([
      {
        id: "question-1",
        result: { answers: { scope: { answers: ["Small"] } } },
      },
    ]);
    expect(events).toContainEqual({
      type: "question.resolved",
      requestId: question.requestId,
      decision: "answered",
    });
    finish();
    await turn;
  });

  it("queues concurrent questions and ignores duplicate server requests", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask(91);
    ask(91);
    ask("92");
    expect(events.filter((e) => e.type === "question.asked")).toHaveLength(1);
    const first = pendingQuestion(events)!;
    respondCodexQuestion("codex-live", first.requestId, { kind: "skipped" });
    await waitFor(
      () => pendingQuestion(events)?.requestId !== first.requestId,
      "next question",
    );
    expect(parse().find((m) => m.id === 91)?.result).toEqual({ answers: {} });
    const next = pendingQuestion(events)!;
    respondCodexQuestion("codex-live", next.requestId, {
      kind: "answered",
      answers: {},
      custom: { scope: "Custom scope" },
    });
    await waitFor(() => !pendingQuestion(events), "custom answer");
    expect(parse().find((m) => m.id === "92")?.result).toEqual({
      answers: { scope: { answers: ["Custom scope"] } },
    });
    finish();
    await turn;
  });

  it("dismisses server-resolved questions without replying or touching another thread", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask();
    const requestId = pendingQuestion(events)!.requestId;
    notify("serverRequest/resolved", {
      threadId: "other",
      requestId: "question-1",
    });
    expect(pendingQuestion(events)).toBeDefined();
    notify("serverRequest/resolved", {
      threadId: "thr_1",
      requestId: "question-1",
    });
    expect(pendingQuestion(events)).toBeUndefined();
    respondCodexQuestion("codex-live", requestId, { kind: "skipped" });
    expect(parse().filter((m) => m.id === "question-1")).toEqual([]);
    finish();
    await turn;
  });

  it("clears pending questions on stop and ignores late requests while interrupted", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask();
    const requestId = pendingQuestion(events)!.requestId;
    const cancel = cancelCodexTurn("codex-live");
    expect(pendingQuestion(events)).toBeUndefined();
    await waitFor(
      () => parse().some((m) => m.method === "turn/interrupt"),
      "interrupt",
    );
    reply(parse().find((m) => m.method === "turn/interrupt")!.id as number, {});
    await cancel;
    await turn;
    ask("late");
    respondCodexQuestion("codex-live", requestId, {
      kind: "answered",
      answers: { scope: ["Small"] },
    });
    expect(pendingQuestion(events)).toBeUndefined();
    expect(parse().some((m) => m.id === "question-1")).toBe(false);
  });

  it("clears all queued questions on turn completion", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask(91);
    ask(92);
    finish();
    await turn;
    expect(pendingQuestion(events)).toBeUndefined();
    expect(events.filter((e) => e.type === "question.asked")).toHaveLength(1);
    expect(parse().some((m) => m.id === 91 || m.id === 92)).toBe(false);
  });

  it("clears questions on process exit and rejects the active turn", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask();
    const rejected = expect(turn).rejects.toThrow("Codex app-server exited");
    onExit!(1);
    await rejected;
    expect(pendingQuestion(events)).toBeUndefined();
  });

  it("does not reuse question callbacks after a session restart", async () => {
    const first = await startTurn("codex-live");
    ask();
    const oldId = pendingQuestion(first.events)!.requestId;
    await stopCodexSession("codex-live");
    await first.turn;
    expect(pendingQuestion(first.events)).toBeUndefined();
    sent.length = 0;
    // Discard the provider binding so startTurn can initialize a fresh thread.
    __codexTestReset();
    const second = await startTurn("codex-live");
    ask();
    expect(pendingQuestion(second.events)!.requestId).not.toBe(oldId);
    respondCodexQuestion("codex-live", oldId, { kind: "skipped" });
    expect(parse().some((m) => m.id === "question-1")).toBe(false);
    finish();
    await second.turn;
  });

  it("keeps the answer form available for retry after a transport write failure", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask();
    const requestId = pendingQuestion(events)!.requestId;
    failWrite = true;
    respondCodexQuestion("codex-live", requestId, { kind: "skipped" });
    await waitFor(
      () =>
        events.some((e) => e.type === "status" && e.text.includes("try again")),
      "write failure",
    );
    expect(pendingQuestion(events)?.requestId).toBe(requestId);
    failWrite = false;
    respondCodexQuestion("codex-live", requestId, { kind: "skipped" });
    await waitFor(() => !pendingQuestion(events), "retry");
    finish();
    await turn;
  });

  it("ignores questions from another thread, turn, or a finished turn", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask(91, { threadId: "wrong-thread" });
    ask(92, { turnId: "wrong-turn" });
    expect(pendingQuestion(events)).toBeUndefined();
    finish();
    await turn;
    ask(93);
    expect(pendingQuestion(events)).toBeUndefined();
  });

  it("rejects malformed questions without leaving an unanswerable form", async () => {
    const { events, turn } = await startTurn("codex-live");
    ask(91, { questions: [] });
    expect(parse().find((m) => m.id === 91)?.error).toEqual({
      code: -32602,
      message: "Invalid Codex questions",
    });
    expect(pendingQuestion(events)).toBeUndefined();
    finish();
    await turn;
  });

  it("stays busy after an agent message until turn/completed", async () => {
    const { events, turn } = await startTurn("codex-live");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    notify("item/completed", {
      item: {
        id: "msg_1",
        type: "agentMessage",
        text: "I'll inspect the changelog first.",
      },
    });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(settled).toBe(false);
    vi.useRealTimers();

    notify("item/started", {
      item: {
        id: "cmd_1",
        type: "commandExecution",
        command: "git log -1",
        status: "inProgress",
      },
    });
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "tool.started")).toBe(true);

    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    expect(settled).toBe(true);
  });

  it("keeps plan turns read-only without surfacing approval prompts", async () => {
    const { events, turn } = await startTurn("codex-live", {
      runtimeMode: "auto",
      intent: "plan",
    });
    const turnStart = parse().find(
      (message) => message.method === "turn/start",
    );
    expect(turnStart?.params).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
      collaborationMode: { mode: "plan" },
    });

    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd_1", command: "git status --short" },
      }),
    );
    await waitFor(
      () => parse().some((message) => message.id === 91),
      "silent plan denial",
    );

    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );
    expect(parse().find((message) => message.id === 91)?.result).toEqual({
      decision: "decline",
    });

    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
  });

  it("uses thread/compact/start and waits for its turn to complete", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    sent.length = 0;

    const compact = compactCodexContext({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () =>
        parse().some((message) => message.method === "thread/compact/start"),
      "thread/compact/start",
    );
    const request = parse().find(
      (message) => message.method === "thread/compact/start",
    )!;
    expect(request.params).toEqual({ threadId: "thr_1" });
    reply(request.id as number, {});

    let settled = false;
    void compact.then(() => {
      settled = true;
    });
    notify("turn/started", {
      turn: { id: "compact_1", status: "inProgress" },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    notify("turn/completed", {
      turn: { id: "compact_1", status: "completed" },
    });
    await compact;
    expect(settled).toBe(true);
  });

  it("sends an exact selected model and records only the returned turn identity", async () => {
    const { events, turn } = await startTurn("codex-live", {
      model: "codex:gpt-5.6-sol",
      turnId: "dispatch-1",
    });
    const messages = parse();
    expect(
      messages.find((m) => m.method === "thread/start")?.params,
    ).toMatchObject({ model: "gpt-5.6-sol" });
    expect(
      messages.find((m) => m.method === "turn/start")?.params,
    ).toMatchObject({ model: "gpt-5.6-sol" });
    await waitFor(
      () => events.some((event) => event.type === "turn.identity"),
      "turn identity",
    );
    expect(events.find((event) => event.type === "turn.identity")).toEqual({
      type: "turn.identity",
      turnId: "dispatch-1",
      providerTurnId: "turn_1",
      providerSessionId: "thr_1",
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });
  it("resumes an interrupted session with the newly selected exact model", async () => {
    const first = await startTurn("codex-live", {
      model: "codex:gpt-5.6-sol",
      turnId: "first",
    });
    await stopCodexSession("codex-live");
    await first.turn.catch(() => undefined);
    sent.length = 0;
    const events: HarnessEvent[] = [];
    const resumed = sendCodexTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-6-astra",
      turnId: "second",
      runtimeMode: "supervised",
      text: "Continue",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    await waitFor(
      () => parse().some((m) => m.method === "initialize"),
      "resume initialize",
    );
    reply(parse().find((m) => m.method === "initialize")!.id as number, {});
    await waitFor(
      () => parse().some((m) => m.method === "thread/resume"),
      "thread/resume",
    );
    const resume = parse().find((m) => m.method === "thread/resume")!;
    expect(resume.params).toMatchObject({
      threadId: "thr_1",
      model: "gpt-6-astra",
    });
    reply(resume.id as number, { thread: { id: "thr_1" } });
    await waitFor(
      () => parse().some((m) => m.method === "turn/start"),
      "resumed turn/start",
    );
    const start = parse().find((m) => m.method === "turn/start")!;
    expect(start.params).toMatchObject({ model: "gpt-6-astra" });
    reply(start.id as number, { turn: { id: "turn_2" } });
    await waitFor(
      () => events.some((event) => event.type === "turn.identity"),
      "resumed identity",
    );
    expect(events.find((event) => event.type === "turn.identity")).toEqual({
      type: "turn.identity",
      turnId: "second",
      providerTurnId: "turn_2",
      providerSessionId: "thr_1",
    });
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await resumed;
  });
});
