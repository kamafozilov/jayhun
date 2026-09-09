// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTypeIcon } from "./FileTypeIcon";

vi.mock("react-material-icon-theme", () => ({
  getFileIcon: ({ fileExtension }: { fileExtension?: string }) =>
    fileExtension ?? "",
  getFolderIcon: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? "folder-open" : "folder",
  getIconSvg: (name: string) => `<svg data-icon="${name}"><path /></svg>`,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FileTypeIcon DOM updates", () => {
  it("preserves unchanged SVGs through repeated parent updates in hidden panels", async () => {
    const render = (tick: number) =>
      root.render(
        createElement(
          "div",
          { hidden: true, "data-tick": tick },
          Array.from({ length: 32 }, (_, key) =>
            createElement(FileTypeIcon, { key, name: "file.ts", isDir: false }),
          ),
        ),
      );
    await act(async () => render(0));
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs).toHaveLength(32);
    const writes = vi.spyOn(Element.prototype, "innerHTML", "set");

    for (let tick = 1; tick <= 20; tick++) act(() => render(tick));

    expect(writes).not.toHaveBeenCalled();
    container.querySelectorAll("svg").forEach((svg, index) => {
      expect(svg).toBe(svgs[index]);
    });
  });

  it("resizes and renames without replacing a glyph, but refreshes changed glyphs", async () => {
    const render = (name: string, size: number) =>
      root.render(createElement(FileTypeIcon, { name, size, isDir: false }));
    await act(async () => render("first.ts", 16));
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-icon")).toBe("ts");
    const writes = vi.spyOn(Element.prototype, "innerHTML", "set");

    act(() => render("first.ts", 24));
    const icon = container.firstElementChild as HTMLElement;
    expect(icon.style.width).toBe("24px");
    expect(icon.style.height).toBe("24px");
    expect(container.querySelector("svg")).toBe(svg);
    expect(writes).not.toHaveBeenCalled();

    act(() => render("second.ts", 24));
    expect(container.querySelector("svg")).toBe(svg);
    expect(writes).not.toHaveBeenCalled();

    act(() => render("second.rs", 24));
    expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "rs",
    );
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("updates folder glyphs when their expansion state changes", async () => {
    const render = (isOpen: boolean) =>
      root.render(
        createElement(FileTypeIcon, { name: "src", isDir: true, isOpen }),
      );
    await act(async () => render(false));
    expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "folder",
    );
    act(() => render(true));
    expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "folder-open",
    );
  });
});
