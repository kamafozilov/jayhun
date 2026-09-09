import { afterEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays, setHarnessModels } from "../models";
import type { HarnessId } from "../session";
import {
  HARNESS_IDLE_PARK_MS,
  canCompactHarnessContext,
  compactHarnessContext,
  isLiveHarness,
  listHarnesses,
  refreshHarnessCatalogs,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  type HarnessAdapter,
} from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";
import { registerBuiltinHarnesses } from "./register";

function stub(
  id: "cursor" | "codex" | "claude" | "pi",
  extra: Partial<HarnessAdapter> = {},
): HarnessAdapter {
  return {
    id,
    live: true,
    async sendTurn(_input: SendTurnInput) {},
    async steerTurn(_input: SteerTurnInput) {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    ...extra,
  };
}

describe("harness registry", () => {
  afterEach(() => {
    resetHarnessModelOverlays();
    resetHarnessIdlePark();
    vi.useRealTimers();
  });

  it("sends an exact cold-catalog selection and rejects unavailable models without substitution", async () => {
    const sendTurn = vi.fn(async () => undefined);
    registerHarness(stub("codex", { sendTurn }));
    const input = {
      harness: "codex" as const,
      sessionId: "exact",
      cwd: "/tmp",
      model: "codex:gpt-5.6-sol",
      text: "Hi",
      runtimeMode: "supervised" as const,
      onEvent: () => undefined,
    };
    await sendHarnessTurn(input);
    expect(sendTurn).toHaveBeenLastCalledWith(input);
    setHarnessModels("codex", [
      { id: "codex:gpt-6-astra", harness: "codex", name: "Astra" },
    ]);
    await expect(sendHarnessTurn(input)).rejects.toThrow("unavailable");
    expect(sendTurn).toHaveBeenCalledOnce();
    resetHarnessModelOverlays();
    await expect(
      sendHarnessTurn({ ...input, model: "claude:sonnet-5" }),
    ).rejects.toThrow("does not belong");
    await expect(sendHarnessTurn({ ...input, model: "" })).rejects.toThrow(
      "Choose a model",
    );
    expect(sendTurn).toHaveBeenCalledOnce();
  });

  it("permits exact native aliases without rewriting the selected ID", async () => {
    const sendTurn = vi.fn(async () => undefined);
    registerHarness(stub("claude", { sendTurn }));
    setHarnessModels("claude", [
      {
        id: "claude:sonnet-5",
        harness: "claude",
        name: "Sonnet",
        nativeId: "claude-sonnet-5",
      },
    ]);
    const input = {
      harness: "claude" as const,
      sessionId: "alias",
      cwd: "/tmp",
      model: "claude:claude-sonnet-5",
      text: "Hi",
      runtimeMode: "supervised" as const,
      onEvent: () => undefined,
    };
    await sendHarnessTurn(input);
    expect(sendTurn).toHaveBeenLastCalledWith(input);
    await expect(
      sendHarnessTurn({ ...input, model: "claude:claude-sonnet" }),
    ).rejects.toThrow("unavailable");
  });

  it("keeps exact send identity after catalog discovery fails", async () => {
    const sendTurn = vi.fn(async () => undefined);
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    registerHarness(
      stub("codex", {
        sendTurn,
        refreshCatalog: async () => {
          throw new Error("offline");
        },
      }),
    );
    try {
      await refreshHarnessCatalogs(["codex"]);
      const input = {
        harness: "codex" as const,
        sessionId: "offline",
        cwd: "/tmp",
        model: "codex:gpt-5.6-sol",
        text: "Hi",
        runtimeMode: "supervised" as const,
        onEvent: () => undefined,
      };
      await sendHarnessTurn(input);
      expect(sendTurn).toHaveBeenLastCalledWith(input);
    } finally {
      debug.mockRestore();
    }
  });

  it("tracks live adapters", () => {
    registerHarness(stub("cursor"));
    registerHarness(stub("codex"));
    registerHarness(stub("claude"));
    expect(isLiveHarness("cursor")).toBe(true);
    expect(isLiveHarness("codex")).toBe(true);
    expect(isLiveHarness("claude")).toBe(true);
    expect(
      listHarnesses()
        .map((a) => a.id)
        .filter((id) => id === "claude" || id === "codex" || id === "cursor")
        .sort(),
    ).toEqual(["claude", "codex", "cursor"]);
  });

  it("advertises and dispatches compaction only when an adapter supports it", async () => {
    const compactContext = vi.fn(async () => undefined);
    registerHarness(stub("codex", { compactContext }));
    registerHarness(stub("claude"));

    expect(canCompactHarnessContext("codex")).toBe(true);
    expect(canCompactHarnessContext("claude")).toBe(false);

    await compactHarnessContext({
      harness: "codex",
      sessionId: "compact-1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(compactContext).toHaveBeenCalledOnce();
    await expect(
      compactHarnessContext({
        harness: "claude",
        sessionId: "compact-2",
        cwd: "/tmp",
        model: "claude:sonnet",
        runtimeMode: "supervised",
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("does not support manual compaction");
  });

  it("exposes the native compaction support matrix", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
    ];

    expect(
      Object.fromEntries(ids.map((id) => [id, canCompactHarnessContext(id)])),
    ).toEqual({
      claude: true,
      codex: true,
      cursor: false,
      grok: true,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
    });
  });

  it("refreshes only the requested catalogs", async () => {
    const pi = vi.fn(async () => undefined);
    const claude = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    registerHarness(stub("claude", { refreshCatalog: claude }));

    await refreshHarnessCatalogs(["claude"]);

    expect(claude).toHaveBeenCalledOnce();
    expect(pi).not.toHaveBeenCalled();
  });

  it("does not spawn a catalog probe twice after a live list lands", async () => {
    const pi = vi.fn(async () => {
      setHarnessModels("pi", [
        {
          id: "pi:opus",
          harness: "pi",
          name: "Opus",
          nativeId: "anthropic/opus",
        },
      ]);
    });
    registerHarness(stub("pi", { refreshCatalog: pi }));

    await refreshHarnessCatalogs(["pi"]);
    await refreshHarnessCatalogs(["pi"]);

    expect(pi).toHaveBeenCalledOnce();
  });

  it("skips catalog refresh when no harness is in use", async () => {
    const pi = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    await refreshHarnessCatalogs([]);
    expect(pi).not.toHaveBeenCalled();
  });

  it("parks a live child a few minutes after the turn settles", async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn(async () => undefined);
    registerHarness(stub("cursor", { stopSession }));

    await sendHarnessTurn({
      harness: "cursor",
      sessionId: "s1",
      cwd: "/tmp",
      model: "cursor:composer-2.5",
      text: "hi",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stopSession).toHaveBeenCalledWith("s1");
  });
});
