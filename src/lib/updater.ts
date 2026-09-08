import { getVersion } from "@tauri-apps/api/app";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { announceUpdateAvailable } from "./sounds";
import { rememberInstalledUpdate } from "./updateNotice";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export type UpdaterSnapshot = {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  error?: string;
  demo?: boolean;
};

let pendingUpdate: Update | null = null;
let snapshot: UpdaterSnapshot = { phase: "idle", currentVersion: "…" };
const listeners = new Set<() => void>();
export const getUpdaterSnapshot = () => snapshot;
export function subscribeUpdater(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(
  next: UpdaterSnapshot,
  callback?: (value: UpdaterSnapshot) => void,
) {
  snapshot = next;
  listeners.forEach((listener) => listener());
  callback?.(next);
}
export async function previewUpdate() {
  if (
    !import.meta.env.DEV ||
    ["downloading", "installing"].includes(snapshot.phase)
  )
    return;
  publish({
    phase: "available",
    currentVersion: await readAppVersion(),
    availableVersion: "Preview",
    demo: true,
  });
}
let initialization: Promise<unknown> | undefined;
export function initializeUpdater() {
  initialization ??= import.meta.env.DEV
    ? readAppVersion().then((currentVersion) =>
        publish({ phase: "idle", currentVersion }),
      )
    : runUpdateFlow(false);
  return initialization;
}

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let lastCheck = 0;
export function startUpdater() {
  void initializeUpdater();
  if (import.meta.env.DEV) return;
  const checkWhenDue = () => {
    if (
      Date.now() - lastCheck >= CHECK_INTERVAL &&
      !["available", "downloading", "ready", "installing"].includes(
        snapshot.phase,
      )
    ) {
      void runUpdateFlow(false);
    }
  };
  const timer = window.setInterval(checkWhenDue, CHECK_INTERVAL);
  window.addEventListener("focus", checkWhenDue);
  window.addEventListener("online", checkWhenDue);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", checkWhenDue);
    window.removeEventListener("online", checkWhenDue);
  };
}
let operation: Promise<UpdaterSnapshot> | undefined;
function exclusive(action: () => Promise<UpdaterSnapshot>) {
  operation ??= Promise.resolve()
    .then(action)
    .finally(() => {
      operation = undefined;
    });
  return operation;
}

function isUpdaterNotConfiguredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /updater does not have any endpoints set/i.test(text);
}

export async function readAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

export function runUpdateFlow(
  manual: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  return exclusive(() => checkForUpdate(manual, onProgress));
}

async function checkForUpdate(
  manual: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  if (
    ["checking", "downloading", "ready", "installing"].includes(snapshot.phase)
  )
    return snapshot;
  const currentVersion = await readAppVersion();
  if (import.meta.env.DEV) {
    const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
    publish(idle, onProgress);
    if (manual)
      await message(
        "Updates are installed in packaged builds. Use Preview update to test the interface.",
        { title: "Jayhun" },
      );
    return idle;
  }
  lastCheck = Date.now();
  const base: UpdaterSnapshot = { phase: "checking", currentVersion };
  publish(base, onProgress);

  try {
    const update = await check({ timeout: 15000 });
    if (!update) {
      await pendingUpdate?.close();
      pendingUpdate = null;
      const current: UpdaterSnapshot = { phase: "current", currentVersion };
      publish(current, onProgress);
      if (manual) {
        await message("You're on the latest version.", { title: "Jayhun" });
      }
      return current;
    }

    await pendingUpdate?.close();
    pendingUpdate = update;
    announceUpdateAvailable(update.version);
    const available: UpdaterSnapshot = {
      phase: "available",
      currentVersion,
      availableVersion: update.version,
    };
    publish(available, onProgress);

    if (!manual) return available;

    const notes = update.body?.trim();
    const detail = notes ? `\n\n${notes}` : "";
    const yes = await ask(
      `Jayhun ${update.version} is available (you have ${currentVersion}).${detail}\n\nDownload now?`,
      { title: "Update available", kind: "info" },
    );
    if (!yes) return available;

    return downloadPendingUpdate(onProgress);
  } catch (err) {
    if (isUpdaterNotConfiguredError(err)) {
      pendingUpdate = null;
      const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
      publish(idle, onProgress);
      if (manual) {
        await message(
          "Automatic updates aren't configured for this build.\n\nDownload releases at https://github.com/kamafozilov/jayhun/releases/latest",
          { title: "Jayhun" },
        );
      }
      return idle;
    }

    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = { phase: "error", currentVersion, error };
    publish(failed, onProgress);
    if (manual) {
      await message(`Couldn't check for updates.\n\n${error}`, {
        title: "Jayhun",
      });
    }
    return failed;
  }
}

export function installPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  return exclusive(() => downloadPendingUpdate(onProgress));
}

async function downloadPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  if (["downloading", "installing", "ready"].includes(snapshot.phase))
    return snapshot;
  if (import.meta.env.DEV && snapshot.demo) {
    const base = snapshot;
    publish({ ...base, phase: "downloading", progress: 0 }, onProgress);
    for (let progress = 1; progress <= 100; progress++) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      publish({ ...base, phase: "downloading", progress }, onProgress);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    publish({ ...base, phase: "ready", progress: 100 }, onProgress);
    return snapshot;
  }
  const currentVersion = await readAppVersion();
  const update = pendingUpdate;
  if (!update) {
    const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
    publish(idle, onProgress);
    return idle;
  }

  let downloaded = 0;
  let contentLength = 0;

  const downloading: UpdaterSnapshot = {
    phase: "downloading",
    currentVersion,
    availableVersion: update.version,
    progress: 0,
  };
  publish(downloading, onProgress);

  try {
    await update.download((event: DownloadEvent) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }

      const progress =
        event.event === "Finished"
          ? 100
          : contentLength > 0
            ? Math.min(100, Math.floor((downloaded / contentLength) * 100))
            : undefined;

      publish(
        {
          phase: "downloading",
          currentVersion,
          availableVersion: update.version,
          progress,
        },
        onProgress,
      );
    });

    const ready: UpdaterSnapshot = {
      phase: "ready",
      currentVersion,
      availableVersion: update.version,
      progress: 100,
    };
    publish(ready, onProgress);
    return ready;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = {
      phase: "error",
      currentVersion,
      availableVersion: update.version,
      error,
    };
    publish(failed, onProgress);
    await message(`Couldn't download the update.\n\n${error}`, {
      title: "Jayhun",
    });
    return failed;
  }
}

let installed = false;
export async function restartToUpdate() {
  if (snapshot.phase !== "ready") return;
  if (import.meta.env.DEV && snapshot.demo) {
    publish({ phase: "current", currentVersion: snapshot.currentVersion });
    return;
  }
  const update = pendingUpdate;
  if (!update) return;
  publish({ ...snapshot, phase: "installing" });
  try {
    if (!installed) {
      await update.install();
      installed = true;
      rememberInstalledUpdate(update.version);
    }
    await relaunch();
  } catch (error) {
    publish({ ...snapshot, phase: "ready", error: String(error) });
    await message(`Couldn't restart to update.\n\n${String(error)}`, {
      title: "Jayhun",
    });
  }
}
