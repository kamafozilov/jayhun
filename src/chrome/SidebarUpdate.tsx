import { ArrowDownCircle, Loader, RefreshCw } from "./icons";
import { useEffect, useSyncExternalStore } from "react";
import {
  installPendingUpdate,
  startUpdater,
  getUpdaterSnapshot,
  subscribeUpdater,
  restartToUpdate,
} from "../lib/updater";
import type { InstalledUpdate } from "../lib/updateNotice";
import { UpdateRailCard } from "./UpdateRailCard";

export function SidebarUpdateFooter({
  update,
  onOpenWhatsNew,
  onDismissUpdate,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-2 pb-1">
      {update && onOpenWhatsNew && onDismissUpdate ? (
        <UpdateRailCard
          update={update}
          onOpen={onOpenWhatsNew}
          onDismiss={onDismissUpdate}
        />
      ) : null}
      <SidebarUpdate />
    </div>
  );
}

export function SidebarUpdate() {
  const snapshot = useSyncExternalStore(subscribeUpdater, getUpdaterSnapshot);
  useEffect(() => {
    return startUpdater();
  }, [startUpdater]);
  const { phase } = snapshot;
  if (
    ![
      "available",
      "downloading",
      "verifying",
      "ready",
      "installing",
      "error",
    ].includes(phase) ||
    (phase === "error" && !snapshot.availableVersion)
  )
    return null;
  const busy =
    phase === "downloading" || phase === "verifying" || phase === "installing";
  const label =
    phase === "downloading"
      ? "Downloading…"
      : phase === "verifying"
        ? "Verifying update…"
        : phase === "installing"
          ? "Restarting…"
          : phase === "ready"
            ? "Restart to update"
            : phase === "error"
              ? "Retry download"
              : "Update available";
  return (
    <button
      type="button"
      onClick={() => {
        void (phase === "ready" ? restartToUpdate() : installPendingUpdate());
      }}
      disabled={busy}
      title={
        snapshot.demo
          ? "Update preview. No download or restart will occur."
          : snapshot.error
      }
      className="relative isolate flex w-full items-center gap-2 overflow-hidden rounded-lg bg-content/5 px-2 py-2 text-left text-content/75 transition-colors hover:bg-content/10 hover:text-content disabled:cursor-default"
    >
      {phase === "downloading" ? (
        <span
          role="progressbar"
          aria-label="Update download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={snapshot.progress}
          className={`absolute inset-y-0 left-0 -z-10 bg-content/10 transition-[width] duration-150 motion-reduce:transition-none ${snapshot.progress == null ? "animate-pulse motion-reduce:animate-none" : ""}`}
          style={{ width: `${snapshot.progress ?? 33}%` }}
        />
      ) : null}
      <span className="grid size-[18px] shrink-0 place-items-center">
        {busy ? (
          <Loader
            className="size-4 animate-spin motion-reduce:animate-none opacity-70"
            aria-hidden
          />
        ) : phase === "ready" ? (
          <RefreshCw className="size-4 opacity-70" aria-hidden />
        ) : (
          <ArrowDownCircle className="size-4 opacity-70" aria-hidden />
        )}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight"
        aria-live="polite"
      >
        {label}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-content/60">
        {phase === "downloading"
          ? snapshot.progress == null
            ? "…"
            : `${snapshot.progress}%`
          : snapshot.demo
            ? "Demo"
            : `v${snapshot.availableVersion}`}
      </span>
    </button>
  );
}
