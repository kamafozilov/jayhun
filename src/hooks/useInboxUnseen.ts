import { useCallback, useEffect, useRef, useState } from "react";
import {
  inboxItemKey,
  inboxProjectsForRail,
  listInboxItems,
  type InboxItem,
  type InboxQuery,
} from "../lib/githubTasks";
import {
  applyInboxFilters,
  inboxFetchState,
  loadInboxFilters,
  pruneInboxFilters,
} from "../lib/inboxFilters";
import {
  inboxHasUnseenItems,
  isInboxEntryUnseen,
  seedInboxSeenIfNeeded,
  subscribeInboxSeen,
  type InboxSeenEntry,
} from "../lib/inboxSeen";
import { loadHiddenLinearTeamIds } from "../lib/linear";
import type { RecentProject } from "../lib/recents";
import { noteInboxUnseen } from "../lib/sounds";

const POLL_MS = 30_000;

function seenEntries(items: readonly InboxItem[]): InboxSeenEntry[] {
  return items.map((item) => ({
    key: inboxItemKey(item),
    updatedAt: item.updatedAt,
  }));
}

export function useInboxUnseen(recents: RecentProject[], cwd: string): boolean {
  const [unseen, setUnseen] = useState(false);
  const entriesRef = useRef<InboxSeenEntry[]>([]);

  const applyUnseen = useCallback((next: boolean) => {
    setUnseen(next);
  }, []);

  useEffect(() => {
    return subscribeInboxSeen(() => {
      applyUnseen(inboxHasUnseenItems(entriesRef.current));
    });
  }, [applyUnseen]);

  useEffect(() => {
    const projects = inboxProjectsForRail(recents, cwd);
    if (projects.length === 0) {
      entriesRef.current = [];
      applyUnseen(false);
      return;
    }

    let cancelled = false;
    let pulling = false;

    const pull = (force: boolean) => {
      if (pulling) return;
      pulling = true;
      const projectPaths = projects.map((project) => project.path);
      const filters = pruneInboxFilters(loadInboxFilters(), projectPaths);
      const query: InboxQuery = {
        assignedToMe: filters.assignedToMe,
        state: inboxFetchState(filters),
        search: "",
        linearHiddenTeamIds: loadHiddenLinearTeamIds(),
      };
      void listInboxItems(projects, query, { force })
        .then((listed) => {
          if (cancelled || Object.keys(listed.errors).length > 0) return;
          const visible = applyInboxFilters(listed.items, filters, "");
          const entries = seenEntries(visible);
          entriesRef.current = entries;
          seedInboxSeenIfNeeded(seenEntries(listed.items));
          noteInboxUnseen(
            seenEntries(listed.items),
            new Set(
              entries.filter(isInboxEntryUnseen).map((entry) => entry.key),
            ),
          );
          applyUnseen(inboxHasUnseenItems(entries));
        })
        .catch(() => {
          // Leave the last known badge; a later poll can try again.
        })
        .finally(() => {
          pulling = false;
        });
    };

    pull(false);
    const timer = window.setInterval(() => {
      pull(true);
    }, POLL_MS);
    const onVis = () => {
      if (!document.hidden) pull(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyUnseen, cwd, recents]);

  return unseen;
}
