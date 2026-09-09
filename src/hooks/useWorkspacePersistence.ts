import { useEffect } from "react";
import type { WorkspaceTab } from "../lib/layout";
import type { Session } from "../lib/session";
import type { ProjectTerminalDock } from "../lib/projectTerminal";
import { saveWorkspaceSnapshot } from "../lib/sessionStore";
import {
  collectWorkspaceSnapshot,
  workspaceSnapshotKey,
} from "../lib/workspaceSnapshot";

export function useWorkspacePersistence(
  tabs: WorkspaceTab[],
  sessions: Session[],
  activeTabId: string,
  projectCwd: string,
  projectTerminals: ProjectTerminalDock[],
  windowTransfer: boolean,
) {
  // Transcript updates do not change the saved workspace. Depending on the
  // serialized snapshot keeps those renders from cancelling a pending save.
  const key = windowTransfer
    ? null
    : workspaceSnapshotKey(
        collectWorkspaceSnapshot(
          tabs,
          sessions,
          activeTabId,
          projectCwd,
          projectTerminals,
        ),
      );

  useEffect(() => {
    if (key === null) return;
    const timer = window.setTimeout(() => {
      void saveWorkspaceSnapshot(JSON.parse(key)).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [key]);
}
