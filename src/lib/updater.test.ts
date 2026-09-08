import { beforeEach, describe, expect, it, vi } from "vitest";

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
    callback({ event: "Finished" });
  });
  const updater = await updaterWithPendingUpdate();
  const progress = vi.fn();
  await updater.installPendingUpdate(progress);
  expect(progress.mock.calls.map(([value]) => value.progress)).toEqual([
    0, 0, 25, 100, 100,
  ]);
  expect(updater.getUpdaterSnapshot().phase).toBe("ready");
});

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
