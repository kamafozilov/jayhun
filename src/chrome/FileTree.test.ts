// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetDir, listCachedDir, notifyDirsChanged } from "../lib/fileTree";
import type { FsEntry } from "../lib/fs";
import { FileTree } from "./FileTree";

const { iconRender, directories } = vi.hoisted(() => ({
  iconRender: vi.fn(),
  directories: new Map<string, FsEntry[]>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: { path: string }) => {
    if (command !== "list_dir")
      throw new Error(`Unexpected command: ${command}`);
    return directories.get(args.path) ?? [];
  }),
}));

// Measure row work independently of FileTypeIcon's own memoization.
vi.mock("./FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => {
    iconRender(name);
    return createElement("span", { "data-icon": name });
  },
}));

let container: HTMLDivElement;
let root: Root;
let cwd: string;
let props: ComponentProps<typeof FileTree>;
let project = 0;

function entry(name: string, parent = cwd, isDir = false): FsEntry {
  return { name, path: `${parent}/${name}`, isDir, ignored: false };
}

function render(tick = 0, hidden = false) {
  root.render(
    createElement(
      "div",
      { hidden, "data-tick": tick },
      // Sidebar keys the tree by project so expansion/selection stay isolated.
      createElement(FileTree, { ...props, key: props.cwd }),
    ),
  );
}

function row(name: string, parent = cwd): HTMLButtonElement {
  return container.querySelector(
    `[role="treeitem"][title="${parent}/${name}"]`,
  )!;
}

function rootToggle(): HTMLButtonElement {
  return container.querySelector(`button[title="${props.cwd}"]`)!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cwd = `/explorer-project-${++project}`;
  props = { cwd, onOpenFile: vi.fn() };
  directories.set(cwd, [entry("first.ts")]);
  await listCachedDir(cwd);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const path of directories.keys()) forgetDir(path);
  directories.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FileTree render isolation", () => {
  it("skips unchanged rows on parent updates in visible and hidden panels", async () => {
    await act(async () => render());
    expect(row("first.ts")).not.toBeNull();
    iconRender.mockClear();

    for (let tick = 1; tick <= 20; tick++) {
      act(() => render(tick, tick > 10));
    }

    expect(iconRender).not.toHaveBeenCalled();
    expect(row("first.ts")).not.toBeNull();
  });

  it("uses a changed navigation callback when no other tree prop changes", async () => {
    await act(async () => render());
    const previous = props.onOpenFile;
    const onOpenFile = vi.fn();
    props = { ...props, onOpenFile };
    act(() => render(1));
    act(() => row("first.ts").click());

    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(`${cwd}/first.ts`);
    expect(previous).not.toHaveBeenCalled();
  });

  it("adds and clears Git decorations when only Git statuses change", async () => {
    await act(async () => render());
    expect(row("first.ts").querySelector(".text-amber-400")).toBeNull();
    props = {
      ...props,
      gitStatuses: {
        files: new Map([[`${cwd}/first.ts`, "modified"]]),
        dirs: new Map(),
      },
    };
    act(() => render(1));
    expect(row("first.ts").querySelector(".text-amber-400")).not.toBeNull();

    props = { ...props, gitStatuses: undefined };
    act(() => render(2));
    expect(row("first.ts").querySelector(".text-amber-400")).toBeNull();
  });

  it("expands nested folders and refreshes both root and nested rows", async () => {
    forgetDir(cwd);
    directories.set(cwd, [entry("src", cwd, true), entry("first.ts")]);
    directories.set(`${cwd}/src`, [entry("before.ts", `${cwd}/src`)]);
    await act(async () => render());
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
    expect(row("before.ts", `${cwd}/src`)).toBeNull();

    await act(async () => row("src").click());
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    expect(row("before.ts", `${cwd}/src`)).not.toBeNull();

    vi.useFakeTimers();
    directories.set(cwd, [entry("src", cwd, true), entry("added.ts")]);
    directories.set(`${cwd}/src`, [entry("after.ts", `${cwd}/src`)]);
    await act(async () => {
      notifyDirsChanged();
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(row("added.ts")).not.toBeNull();
    expect(row("first.ts")).toBeNull();
    expect(row("after.ts", `${cwd}/src`)).not.toBeNull();
    expect(row("before.ts", `${cwd}/src`)).toBeNull();
    act(() => row("after.ts", `${cwd}/src`).click());
    expect(props.onOpenFile).toHaveBeenCalledWith(`${cwd}/src/after.ts`);
  });

  it("switches keyed projects without leaking rows or expansion state", async () => {
    await act(async () => render());
    act(() => rootToggle().click());
    expect(row("first.ts")).toBeNull();

    const next = `${cwd}-next`;
    directories.set(next, [entry("next.ts", next)]);
    props = { ...props, cwd: next };
    await act(async () => render(1));
    expect(rootToggle().getAttribute("aria-expanded")).toBe("true");
    expect(row("next.ts", next)).not.toBeNull();
    expect(row("first.ts")).toBeNull();
    act(() => row("next.ts", next).click());
    expect(props.onOpenFile).toHaveBeenCalledWith(`${next}/next.ts`);

    props = { ...props, cwd };
    await act(async () => render(2));
    expect(rootToggle().getAttribute("aria-expanded")).toBe("false");
    expect(row("next.ts", next)).toBeNull();
    expect(row("first.ts")).toBeNull();
    await act(async () => rootToggle().click());
    expect(row("first.ts")).not.toBeNull();
  });
});
