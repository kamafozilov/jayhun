import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  getVersion: vi.fn(),
  message: vi.fn(),
  relaunch: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: mocks.message,
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("./sounds", () => ({ announceUpdateAvailable: mocks.announce }));
vi.mock("./updateNotice", () => ({ rememberInstalledUpdate: mocks.remember }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DEV", false);
  vi.resetModules();
  mocks.getVersion.mockResolvedValue("0.1.22");
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.message.mockResolvedValue(undefined);
});

async function updaterWithPendingUpdate() {
  const update = {
    version: "0.1.23",
    download: mocks.download,
    install: mocks.install,
    close: vi.fn().mockResolvedValue(undefined),
  };
  mocks.check.mockResolvedValue(update);
  const updater = await import("./updater");
  await updater.runUpdateFlow(false);
  return updater;
}

describe("installPendingUpdate", () => {
  it("downloads first and installs only after an explicit restart", async () => {
    mocks.download.mockResolvedValue(undefined);
    const updater = await updaterWithPendingUpdate();

    const result = await updater.installPendingUpdate();
    expect(result.phase).toBe("ready");
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    await updater.restartToUpdate();

    expect(mocks.remember).toHaveBeenCalledWith("0.1.23");
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.remember.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.relaunch.mock.invocationCallOrder[0]!,
    );
  });

  it("does not record or relaunch after installation fails", async () => {
    mocks.download.mockRejectedValue(new Error("install failed"));
    const updater = await updaterWithPendingUpdate();

    const result = await updater.installPendingUpdate();

    expect(result.phase).toBe("error");
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("does not record when no update is pending", async () => {
    const updater = await import("./updater");

    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});

it("reports byte progress and finishes at 100 percent", async () => {
  mocks.download.mockImplementation(async (callback) => {
    callback({ event: "Started", data: { contentLength: 200 } });
    callback({ event: "Progress", data: { chunkLength: 50 } });
    callback({ event: "Progress", data: { chunkLength: 150 } });
    callback({ event: "Finished" });
  });
  const updater = await updaterWithPendingUpdate();
  const progress = vi.fn();
  await updater.installPendingUpdate(progress);
  expect(progress.mock.calls.map(([value]) => value.progress)).toEqual([
    0, 0, 25, 100, 100, 100,
  ]);
  expect(updater.getUpdaterSnapshot().phase).toBe("ready");
});

it.each([false, true])(
  "waits for signature verification, rejection=%s",
  async (reject) => {
    let finish!: () => void;
    mocks.download.mockImplementation((callback) => {
      callback({ event: "Started", data: { contentLength: 200 } });
      callback({ event: "Progress", data: { chunkLength: 200 } });
      callback({ event: "Finished" });
      return new Promise<void>((resolve, fail) => {
        finish = () =>
          reject ? fail(new Error("Invalid signature")) : resolve();
      });
    });
    const updater = await updaterWithPendingUpdate();
    const states: string[] = [];
    let onVerifying!: () => void;
    const verifying = new Promise<void>((resolve) => {
      onVerifying = resolve;
    });
    const download = updater.installPendingUpdate((state) => {
      states.push(state.phase);
      if (state.phase === "verifying") onVerifying();
    });
    await verifying;
    expect(updater.getUpdaterSnapshot().phase).toBe("verifying");
    await updater.restartToUpdate();
    const recheck = updater.runUpdateFlow(true);
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.check).toHaveBeenCalledOnce();
    finish();
    await Promise.all([download, recheck]);
    expect(updater.getUpdaterSnapshot().phase).toBe(reject ? "error" : "ready");
    if (reject) expect(states).not.toContain("ready");
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  },
);

it("keeps progress unknown when the server omits content length", async () => {
  mocks.download.mockImplementation(async (callback) => {
    callback({ event: "Started", data: {} });
    callback({ event: "Progress", data: { chunkLength: 50 } });
  });
  const updater = await updaterWithPendingUpdate();
  const progress = vi.fn();
  await updater.installPendingUpdate(progress);
  expect(progress.mock.calls[2][0].progress).toBeUndefined();
  expect(updater.getUpdaterSnapshot().progress).toBe(100);
});

it("shares a check between simultaneous callers", async () => {
  mocks.check.mockResolvedValue(null);
  const updater = await import("./updater");
  await Promise.all([
    updater.runUpdateFlow(false),
    updater.runUpdateFlow(false),
  ]);
  expect(mocks.check).toHaveBeenCalledOnce();
});

it("downloads only once when two views request the update", async () => {
  mocks.download.mockResolvedValue(undefined);
  const updater = await updaterWithPendingUpdate();
  await Promise.all([
    updater.installPendingUpdate(),
    updater.installPendingUpdate(),
  ]);
  expect(mocks.download).toHaveBeenCalledOnce();
});

it("does not recheck or replace a downloaded update", async () => {
  mocks.download.mockResolvedValue(undefined);
  const updater = await updaterWithPendingUpdate();
  await updater.installPendingUpdate();
  expect((await updater.runUpdateFlow(false)).phase).toBe("ready");
  expect(mocks.check).toHaveBeenCalledOnce();
});

it("retries a relaunch without installing twice", async () => {
  mocks.download.mockResolvedValue(undefined);
  mocks.relaunch.mockRejectedValueOnce(new Error("relaunch failed"));
  const updater = await updaterWithPendingUpdate();
  await updater.installPendingUpdate();
  await updater.restartToUpdate();
  expect(updater.getUpdaterSnapshot().phase).toBe("ready");
  await updater.restartToUpdate();
  expect(mocks.install).toHaveBeenCalledOnce();
  expect(mocks.relaunch).toHaveBeenCalledTimes(2);
});

it("keeps development startup quiet and never checks the release feed", async () => {
  vi.stubEnv("DEV", true);
  const updater = await import("./updater");
  await updater.initializeUpdater();
  expect(updater.getUpdaterSnapshot()).toEqual({
    phase: "idle",
    currentVersion: "0.1.22",
  });
  expect(mocks.check).not.toHaveBeenCalled();
});

describe("background update schedule", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      }),
    );
    mocks.check.mockResolvedValue(null);
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("waits 15 seconds, then checks every four minutes", async () => {
    const updater = await import("./updater");
    stop = updater.startUpdater();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(mocks.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(239_999);
    expect(mocks.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(mocks.check).toHaveBeenCalledTimes(3);
  });

  it("checks manually at once and schedules from that check", async () => {
    const updater = await import("./updater");
    stop = updater.startUpdater();
    await vi.advanceTimersByTimeAsync(5_000);
    await updater.runUpdateFlow(true);
    expect(mocks.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(239_999);
    expect(mocks.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it.each(["focus", "online"])(
    "checks on %s only when the interval has elapsed",
    async (event) => {
      const updater = await import("./updater");
      stop = updater.startUpdater();
      await vi.advanceTimersByTimeAsync(15_000);
      vi.setSystemTime(254_999);
      window.dispatchEvent(new Event(event));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.check).toHaveBeenCalledOnce();
      vi.setSystemTime(255_000);
      window.dispatchEvent(new Event(event));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.check).toHaveBeenCalledTimes(2);
    },
  );

  it("removes timers and listeners and survives effect replay", async () => {
    const updater = await import("./updater");
    stop = updater.startUpdater();
    stop?.();
    stop = updater.startUpdater();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.check).toHaveBeenCalledOnce();
    stop?.();
    await vi.advanceTimersByTimeAsync(240_000);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps an available update without downloading or rechecking", async () => {
    const updater = await updaterWithPendingUpdate();
    stop = updater.startUpdater();
    await vi.advanceTimersByTimeAsync(480_000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("never starts background checks in development", async () => {
    vi.stubEnv("DEV", true);
    const updater = await import("./updater");
    stop = updater.startUpdater();
    await vi.advanceTimersByTimeAsync(480_000);
    window.dispatchEvent(new Event("online"));
    expect(mocks.check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
