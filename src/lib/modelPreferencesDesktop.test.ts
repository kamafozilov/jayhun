// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as TauriCore from "@tauri-apps/api/core";

// Dynamic imports after resetModules exercise cold starts with a fresh native cache.

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  onChange: null as (() => void) | null,
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriCore>()),
  isTauri: () => true,
  invoke: native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, listener: () => void) => {
    native.onChange = listener;
    return native.unlisten;
  },
}));

const codex = {
  choice: { harness: "codex", model: "codex:live-only" },
  models: { codex: "codex:live-only" },
};
const cursor = {
  choice: { harness: "cursor", model: "cursor:composer-2.5" },
  models: { cursor: "cursor:composer-2.5" },
};
const focusListeners: EventListenerOrEventListenerObject[] = [];

beforeEach(() => {
  vi.resetModules();
  native.invoke.mockReset();
  native.unlisten.mockReset();
  native.onChange = null;
  localStorage.clear();
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type, listener, options) => {
      if (type === "focus") focusListeners.push(listener);
      add(type, listener, options);
    },
  );
});
afterEach(() => {
  for (const listener of focusListeners.splice(0))
    window.removeEventListener("focus", listener);
  vi.restoreAllMocks();
});

async function boot(
  preferences: typeof codex | typeof cursor | { choice: null; models: {} },
) {
  native.invoke.mockResolvedValue(preferences);
  const models = await import("./models");
  await models.initializeModelPreferences();
  return { models, session: await import("./session") };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("desktop default provider persistence", () => {
  it.each([codex, cursor])(
    "restores the saved $choice.harness in a new origin before creating sessions",
    async (saved) => {
      // A release's persisted choice must win over this dev origin's stale cache.
      localStorage.setItem(
        "jayhun.modelPreferences",
        JSON.stringify(saved === codex ? cursor : codex),
      );
      const { models, session } = await boot(saved);
      expect(session.newDefaultSession()).toMatchObject(saved.choice);
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(models.defaultSessionChoice()).toEqual(saved.choice);
    },
  );

  it("does not create a fallback session while the shared store is still loading", async () => {
    const load = deferred<typeof codex>();
    native.invoke.mockReturnValue(load.promise);
    const models = await import("./models");
    const { newDefaultSession } = await import("./session");
    const ready = models.initializeModelPreferences();
    expect(() => newDefaultSession()).toThrow("Provider preferences must load");
    load.resolve(codex);
    await ready;
    expect(newDefaultSession()).toMatchObject(codex.choice);
  });

  it("uses Codex without inventing a saved selection on an empty store", async () => {
    const { models, session } = await boot({ choice: null, models: {} });
    expect(session.newDefaultSession().harness).toBe("codex");
    expect(models.loadLastModelChoice()).toBeNull();
  });

  it("publishes only a committed save and keeps that choice when a later write fails", async () => {
    const { models, session } = await boot(cursor);
    const values: string[] = [];
    const unsubscribe = models.subscribeModelPreferences(() =>
      values.push(session.newDefaultSession().harness),
    );
    const write = deferred<typeof codex>();
    native.invoke.mockReturnValueOnce(write.promise);
    const saving = models.saveLastModelChoice("codex", "codex:live-only");
    expect(session.newDefaultSession()).toMatchObject(cursor.choice);
    expect(values).toEqual([]);
    write.resolve(codex);
    expect(await saving).toBe(true);
    expect(values).toEqual(["codex"]);
    expect(session.newDefaultSession()).toMatchObject(codex.choice);

    vi.spyOn(console, "error").mockImplementation(() => {});
    native.invoke.mockRejectedValueOnce(new Error("disk full"));
    expect(await models.saveLastModelChoice("cursor", "cursor:other")).toBe(
      false,
    );
    expect(values).toEqual(["codex"]);
    expect(session.newDefaultSession()).toMatchObject(codex.choice);
    unsubscribe();
  });

  it("refreshes another app's saved choice on focus and sibling window changes on events", async () => {
    const { models, session } = await boot(codex);
    const inherited = session.newDefaultSession();
    const explicit = session.newSession("codex", "~", "codex:explicit");
    native.invoke.mockResolvedValue(cursor);
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() =>
      expect(models.defaultSessionChoice()).toEqual(cursor.choice),
    );
    expect(session.followSessionDefaults(inherited)).toMatchObject(
      cursor.choice,
    );
    expect(session.followSessionDefaults(explicit)).toBe(explicit);
    native.invoke.mockResolvedValue(codex);
    native.onChange?.();
    await vi.waitFor(() =>
      expect(session.newDefaultSession()).toMatchObject(codex.choice),
    );
  });

  it("orders a slow refresh before a newer save rather than rolling the selection back", async () => {
    const { models, session } = await boot(cursor);
    const load = deferred<typeof cursor>();
    native.invoke
      .mockReturnValueOnce(load.promise)
      .mockResolvedValueOnce(codex);
    window.dispatchEvent(new Event("focus"));
    const saving = models.saveLastModelChoice("codex", "codex:live-only");
    load.resolve(cursor);
    expect(await saving).toBe(true);
    expect(session.newDefaultSession()).toMatchObject(codex.choice);
  });

  it("does not silently select a different provider when disk loading fails", async () => {
    native.invoke.mockRejectedValue(new Error("unreadable preferences"));
    const models = await import("./models");
    await expect(models.initializeModelPreferences()).rejects.toThrow(
      "unreadable preferences",
    );
    expect(() => models.defaultSessionChoice()).toThrow(
      "Provider preferences must load",
    );
    expect(native.unlisten).toHaveBeenCalledOnce();
  });
});
