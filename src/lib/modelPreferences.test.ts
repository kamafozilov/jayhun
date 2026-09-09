// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSessionChoice,
  getModelPreferencesSnapshot,
  loadDefaultModels,
  loadLastModelChoice,
  saveDefaultModel,
  saveLastModelChoice,
  subscribeModelPreferences,
} from "./models";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("persisted provider preferences", () => {
  it("preserves other provider models when migrating legacy preferences", async () => {
    localStorage.setItem(
      "jayhun.lastModel",
      JSON.stringify({ harness: "claude", model: "claude:opus-5" }),
    );
    localStorage.setItem(
      "jayhun.defaultModels",
      JSON.stringify({ claude: "claude:opus-5", pi: "pi:custom" }),
    );
    expect(await saveLastModelChoice("codex", "codex:custom")).toBe(true);
    expect(loadDefaultModels()).toEqual({
      claude: "claude:opus-5",
      pi: "pi:custom",
      codex: "codex:custom",
    });
    expect(defaultSessionChoice()).toEqual({
      harness: "codex",
      model: "codex:custom",
    });
  });

  it.each(["provider", "model"])(
    "keeps the persisted selection and does not publish a failed %s save",
    async (kind) => {
      await saveLastModelChoice("claude", "claude:opus-5");
      const before = getModelPreferencesSnapshot();
      const listener = vi.fn();
      const unsubscribe = subscribeModelPreferences(listener);
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      const saved =
        kind === "provider"
          ? await saveLastModelChoice("codex", "codex:custom")
          : await saveDefaultModel("claude", "claude:sonnet-5");
      expect(saved).toBe(false);
      expect(getModelPreferencesSnapshot()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    },
  );

  it("publishes successful writes after the current value can be read", async () => {
    const values: unknown[] = [];
    const unsubscribe = subscribeModelPreferences(() =>
      values.push(defaultSessionChoice()),
    );
    await saveLastModelChoice("claude", "claude:opus-5");
    await saveDefaultModel("claude", "claude:sonnet-5");
    await saveDefaultModel("pi", "pi:custom");
    expect(values).toEqual([
      { harness: "claude", model: "claude:opus-5" },
      { harness: "claude", model: "claude:sonnet-5" },
      { harness: "claude", model: "claude:sonnet-5" },
    ]);
    unsubscribe();
  });

  it("subscribes to other windows and storage clear, and removes the subscription", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeModelPreferences(listener);
    localStorage.setItem(
      "jayhun.modelPreferences",
      JSON.stringify({
        choice: { harness: "codex", model: "codex:remote" },
        models: { codex: "codex:remote" },
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "jayhun.modelPreferences" }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadLastModelChoice()).toEqual({
      harness: "codex",
      model: "codex:remote",
    });
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(defaultSessionChoice().harness).toBe("codex");
    unsubscribe();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "jayhun.modelPreferences" }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

it("keeps a valid legacy provider when its model map is malformed", () => {
  localStorage.setItem(
    "jayhun.lastModel",
    JSON.stringify({ harness: "claude", model: "claude:opus-5" }),
  );
  localStorage.setItem("jayhun.defaultModels", "{");
  expect(defaultSessionChoice()).toEqual({
    harness: "claude",
    model: "claude:opus-5",
  });
});

it("keeps a valid legacy model map when its provider record is malformed", () => {
  localStorage.setItem("jayhun.lastModel", "{");
  localStorage.setItem(
    "jayhun.defaultModels",
    JSON.stringify({ cursor: "cursor:saved" }),
  );
  expect(loadDefaultModels()).toEqual({ cursor: "cursor:saved" });
  expect(defaultSessionChoice().harness).toBe("codex");
});

it.each([
  "{",
  "[]",
  "{}",
  '{"choice":{"harness":"unknown","model":"bad"},"models":{}}',
])(
  "falls back to valid legacy preferences for malformed unified data %s",
  async (raw) => {
    localStorage.setItem("jayhun.modelPreferences", raw);
    localStorage.setItem(
      "jayhun.lastModel",
      JSON.stringify({ harness: "claude", model: "claude:opus-5" }),
    );
    expect(defaultSessionChoice()).toEqual({
      harness: "claude",
      model: "claude:opus-5",
    });
    expect(await saveDefaultModel("pi", "pi:saved")).toBe(true);
    expect(defaultSessionChoice()).toEqual({
      harness: "claude",
      model: "claude:opus-5",
    });
  },
);
