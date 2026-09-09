import { useEffect } from "react";
import { markInboxItemSeen, type InboxSeenEntry } from "../lib/inboxSeen";
import { useWindowFocused } from "../lib/notifications";

/** A selected card is read when its current version is visible in a focused window. */
export function useInboxItemSeen(entry: InboxSeenEntry | undefined) {
  const focused = useWindowFocused();
  const key = entry?.key;
  const updatedAt = entry?.updatedAt;
  useEffect(() => {
    if (!focused || !key || updatedAt == null) return;
    markInboxItemSeen({ key, updatedAt });
  }, [focused, key, updatedAt]);
}
