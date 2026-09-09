/** Sessions that finished while unfocused, until the user looks at them. */

export function nextUnseenFinishedSessions({
  previousBusyIds,
  busyIds,
  previousUnseenIds,
  focusedSessionId,
  completedIds,
}: {
  previousBusyIds: ReadonlySet<string>;
  busyIds: ReadonlySet<string>;
  previousUnseenIds: ReadonlySet<string>;
  focusedSessionId?: string;
  completedIds?: ReadonlySet<string>;
}): Set<string> {
  const next = new Set(previousUnseenIds);
  for (const id of previousBusyIds) {
    if (
      !busyIds.has(id) &&
      id !== focusedSessionId &&
      (!completedIds || completedIds.has(id))
    )
      next.add(id);
  }
  for (const id of busyIds) next.delete(id);
  if (focusedSessionId) next.delete(focusedSessionId);
  return next;
}

const UNSEEN_KEY = "jayhun.unseenFinishedSessions.v1";

export function loadUnseenFinishedSessions(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(UNSEEN_KEY) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/** Merge this window's changes without removing another window's unread ids. */
export function saveUnseenFinishedSessions(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
) {
  const stored = loadUnseenFinishedSessions();
  for (const id of previous) if (!next.has(id)) stored.delete(id);
  for (const id of next) if (!previous.has(id)) stored.add(id);
  try {
    localStorage.setItem(UNSEEN_KEY, JSON.stringify([...stored]));
  } catch {
    // Keep the current window's state when storage is unavailable.
  }
}
