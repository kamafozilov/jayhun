import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  announceSessionFinished,
  saveNotificationsEnabled,
  setWindowFocused,
} from "./notifications";
import { newSession } from "./session";
const { play } = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("cuelume", () => ({ play, setEnabled: vi.fn(), setVolume: vi.fn() }));
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  play.mockClear();
  setWindowFocused(false);
});
it("uses native sound once when a background completion banner succeeds", async () => {
  saveNotificationsEnabled(true);
  await announceSessionFinished(
    newSession("codex", "/tmp"),
    false,
    true,
    () => true,
  );
  expect(invoke).toHaveBeenCalledWith(
    "show_notification",
    expect.objectContaining({ sound: true }),
  );
  expect(play).not.toHaveBeenCalled();
});
it("falls back to one sound when the OS rejects a banner", async () => {
  saveNotificationsEnabled(true);
  vi.mocked(invoke).mockRejectedValue(new Error("denied"));
  await announceSessionFinished(
    newSession("codex", "/tmp"),
    false,
    true,
    () => true,
  );
  expect(play).toHaveBeenCalledExactlyOnceWith("success");
});
it("plays the completion sound for the visible session without a banner", async () => {
  setWindowFocused(true);
  saveNotificationsEnabled(true);
  await announceSessionFinished(
    newSession("codex", "/tmp"),
    true,
    true,
    () => true,
  );
  expect(invoke).not.toHaveBeenCalled();
  expect(play).toHaveBeenCalledExactlyOnceWith("success");
});
it("does not announce failures, removed sessions, superseded turns, or pending input", async () => {
  const session = newSession("codex", "/tmp");
  await announceSessionFinished(session, false, false, () => true);
  await announceSessionFinished(undefined, false, true, () => true);
  await announceSessionFinished(session, false, true, () => false);
  await announceSessionFinished(
    { ...session, busy: true },
    false,
    true,
    () => true,
  );
  await announceSessionFinished(
    { ...session, pendingQuestion: { requestId: 1, questions: [] } },
    false,
    true,
    () => true,
  );
  expect(invoke).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
});
it("respects mute for both native delivery and in-app fallback", async () => {
  localStorage.setItem("jayhun.sounds", "0");
  saveNotificationsEnabled(true);
  await announceSessionFinished(
    newSession("codex", "/tmp"),
    false,
    true,
    () => true,
  );
  expect(invoke).toHaveBeenCalledWith(
    "show_notification",
    expect.objectContaining({ sound: false }),
  );
  vi.mocked(invoke).mockRejectedValue(new Error("denied"));
  await announceSessionFinished(
    newSession("codex", "/tmp"),
    false,
    true,
    () => true,
  );
  expect(play).not.toHaveBeenCalled();
});
it("does not play a stale fallback if a new turn starts during dispatch", async () => {
  saveNotificationsEnabled(true);
  let current = true;
  vi.mocked(invoke).mockImplementation(async () => {
    current = false;
    throw new Error("denied");
  });
  await announceSessionFinished(
    newSession("codex", "/tmp"),
    false,
    true,
    () => current,
  );
  expect(play).not.toHaveBeenCalled();
});
