import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  watchers: new Map<string, (line: string) => void>(),
  children: new Set<string>(),
  methods: [] as string[],
  reply: (
    _method: string,
  ): { result?: unknown; error?: { code: number; message: string } } => ({
    result: {},
  }),
  execChild: vi.fn(),
}));

vi.mock("../fs", () => ({ homeDir: async () => "/home/test" }));
vi.mock("./child", () => ({
  resolveCursorBinary: async () => ({ path: "/fake/cursor-agent" }),
  spawnChild: async (id: string) => {
    transport.children.add(id);
  },
  killChild: async (id: string) => {
    transport.children.delete(id);
  },
  watchChild: (id: string, onLine: (line: string) => void) => {
    transport.watchers.set(id, onLine);
  },
  unwatchChild: (id: string) => {
    transport.watchers.delete(id);
  },
  writeChild: async (id: string, line: string) => {
    const request = JSON.parse(line) as { id: number; method: string };
    transport.methods.push(request.method);
    transport.watchers.get(id)?.(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        ...transport.reply(request.method),
      }),
    );
  },
  execChild: transport.execChild,
}));

import { modelsFor, resetHarnessModelOverlays } from "../models";
import { refreshCursorCatalog } from "./cursorCatalog";

beforeEach(() => {
  transport.watchers.clear();
  transport.children.clear();
  transport.methods.length = 0;
  transport.execChild.mockReset();
  resetHarnessModelOverlays();
});

afterEach(() => {
  resetHarnessModelOverlays();
  vi.restoreAllMocks();
});

describe("passive Cursor catalog discovery", () => {
  it("lists models using existing credentials without interactive authentication", async () => {
    transport.reply = (method) => ({
      result:
        method === "cursor/list_available_models"
          ? { models: [{ value: "composer-2.5", name: "Composer 2.5" }] }
          : { authMethods: [{ id: "cursor_login", name: "Log in" }] },
    });

    await refreshCursorCatalog();

    expect(modelsFor("cursor")).toEqual([
      expect.objectContaining({
        id: "cursor:composer-2.5",
        name: "Composer 2.5",
      }),
    ]);
    expect(transport.methods).toEqual([
      "initialize",
      "cursor/list_available_models",
    ]);
    expect(transport.execChild).not.toHaveBeenCalled();
    expect(transport.watchers.size).toBe(0);
    expect(transport.children.size).toBe(0);
  });

  it("uses session models when an authenticated ACP listing is empty", async () => {
    transport.reply = (method) => ({
      result:
        method === "session/new"
          ? { models: { availableModels: [{ modelId: "auto", name: "Auto" }] } }
          : {},
    });

    await refreshCursorCatalog();

    expect(modelsFor("cursor")).toEqual([
      expect.objectContaining({ id: "cursor:auto", name: "Auto" }),
    ]);
    expect(transport.methods).toEqual([
      "initialize",
      "cursor/list_available_models",
      "session/new",
    ]);
    expect(transport.execChild).not.toHaveBeenCalled();
    expect(transport.watchers.size).toBe(0);
    expect(transport.children.size).toBe(0);
  });

  it("falls back to CLI models when ACP requires authentication without opening login", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    transport.reply = (method) =>
      method === "initialize"
        ? { result: { authMethods: [{ id: "cursor_login", name: "Log in" }] } }
        : { error: { code: -32000, message: "Authentication required" } };
    transport.execChild.mockImplementation(async () => {
      expect(transport.watchers.size).toBe(0);
      expect(transport.children.size).toBe(0);
      return "auto - Auto (default)\n";
    });

    await refreshCursorCatalog();

    expect(modelsFor("cursor")).toEqual([
      expect.objectContaining({ id: "cursor:auto", name: "Auto" }),
    ]);
    expect(transport.methods).toEqual([
      "initialize",
      "cursor/list_available_models",
    ]);
    expect(transport.execChild).toHaveBeenCalledExactlyOnceWith(
      "/fake/cursor-agent",
      ["--list-models"],
      "/home/test",
    );
    expect(transport.watchers.size).toBe(0);
    expect(transport.children.size).toBe(0);
  });
});
