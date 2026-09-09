// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  getVersion: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("../lib/sounds", () => ({ announceUpdateAvailable: vi.fn() }));
vi.mock("../lib/updateNotice", () => ({ rememberInstalledUpdate: vi.fn() }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubEnv("DEV", false);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Load the footer after this reset so each test gets a fresh updater singleton.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(0);
  mocks.getVersion.mockResolvedValue("0.1.42");
  mocks.install.mockResolvedValue(undefined);
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.check.mockResolvedValue({
    version: "0.1.43",
    download: mocks.download,
    install: mocks.install,
    close: vi.fn(async () => {}),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function updateButton() {
  const button = container.querySelector("button");
  if (!button) throw new Error("Expected an available update action");
  return button;
}

it("appears from an empty footer and preserves download, verification and explicit restart", async () => {
  const { SidebarUpdateFooter } = await import("./SidebarUpdate");
  await act(async () => root.render(createElement(SidebarUpdateFooter)));
  expect(container.childElementCount).toBe(0);

  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(updateButton().disabled).toBe(false);
  expect(container.textContent).toContain("0.1.43");
  expect(mocks.install).not.toHaveBeenCalled();

  let releaseVersion!: (version: string) => void;
  mocks.getVersion.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        releaseVersion = resolve;
      }),
  );
  let progress!: (event: DownloadEvent) => void;
  let verify!: () => void;
  mocks.download.mockImplementation(
    (onProgress: (event: DownloadEvent) => void) => {
      progress = onProgress;
      return new Promise<void>((resolve) => {
        verify = resolve;
      });
    },
  );
  await act(async () => {
    updateButton().click();
    updateButton().click();
  });
  expect(mocks.download).not.toHaveBeenCalled();
  await act(async () => releaseVersion("0.1.42"));
  expect(mocks.download).toHaveBeenCalledOnce();
  expect(updateButton().disabled).toBe(true);

  await act(async () => {
    progress({ event: "Started", data: { contentLength: 200 } });
    progress({ event: "Progress", data: { chunkLength: 50 } });
  });
  expect(
    container
      .querySelector('[role="progressbar"]')
      ?.getAttribute("aria-valuenow"),
  ).toBe("25");
  await act(async () => progress({ event: "Finished" }));
  expect(updateButton().disabled).toBe(true);
  expect(mocks.install).not.toHaveBeenCalled();
  expect(mocks.relaunch).not.toHaveBeenCalled();

  await act(async () => verify());
  expect(updateButton().disabled).toBe(false);
  expect(mocks.install).not.toHaveBeenCalled();
  await act(async () => updateButton().click());
  expect(mocks.install).toHaveBeenCalledOnce();
  expect(mocks.relaunch).toHaveBeenCalledOnce();
});

it("keeps failed background checks empty while an installed notice can be shown and dismissed", async () => {
  mocks.check.mockRejectedValue(new Error("offline"));
  const { SidebarUpdateFooter } = await import("./SidebarUpdate");
  await act(async () => root.render(createElement(SidebarUpdateFooter)));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.childElementCount).toBe(0);

  const dismiss = () => root.render(createElement(SidebarUpdateFooter));
  await act(async () =>
    root.render(
      createElement(SidebarUpdateFooter, {
        update: { version: "0.1.42" },
        onOpenWhatsNew: () => {},
        onDismissUpdate: dismiss,
      }),
    ),
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "0.1.42",
  );
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Dismiss update notification"]',
      )!
      .click();
  });
  expect(container.childElementCount).toBe(0);
});

it("keeps a failed download actionable and allows retry without installing early", async () => {
  mocks.download.mockRejectedValueOnce(new Error("connection interrupted"));
  mocks.download.mockResolvedValueOnce(undefined);
  const { SidebarUpdateFooter } = await import("./SidebarUpdate");
  await act(async () => root.render(createElement(SidebarUpdateFooter)));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  await act(async () => updateButton().click());
  expect(updateButton().disabled).toBe(false);
  expect(updateButton().title).toContain("connection interrupted");
  expect(mocks.install).not.toHaveBeenCalled();
  await act(async () => updateButton().click());
  expect(mocks.download).toHaveBeenCalledTimes(2);
  expect(updateButton().disabled).toBe(false);
  expect(mocks.install).not.toHaveBeenCalled();
});
