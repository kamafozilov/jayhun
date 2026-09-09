// @vitest-environment happy-dom
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { InboxFiltersMenu } from "./InboxFiltersMenu";
import {
  applyInboxFilters,
  inboxFetchState,
  loadInboxFilters,
  saveInboxFilters,
  type InboxFilters,
} from "../lib/inboxFilters";
import type { InboxItem } from "../lib/githubTasks";

const rows: InboxItem[] = [
  { number: 1, kind: "issue", state: "open", draft: false },
  { number: 2, kind: "pr", state: "open", draft: true },
  { number: 3, kind: "issue", state: "closed", draft: false },
  { number: 4, kind: "pr", state: "merged", draft: false },
].map((row) => ({
  ...row,
  kind: row.kind as InboxItem["kind"],
  provider: "github",
  title: `Item ${row.number}`,
  url: "",
  repo: "acme/web",
  projectPath: "/tmp/web",
  updatedAt: "2026-09-09T10:00:00Z",
  labels: [],
  assignees: [],
}));

function Harness() {
  const [filters, setFilters] = useState(loadInboxFilters);
  const onChange = (next: InboxFilters) => {
    setFilters(next);
    saveInboxFilters(next);
  };
  return createElement(
    Fragment,
    null,
    createElement(
      "output",
      null,
      applyInboxFilters(rows, filters, "", Date.now(), "github")
        .map((row) => row.number)
        .join(","),
    ),
    createElement(InboxFiltersMenu, {
      x: 0,
      y: 0,
      projects: [],
      linearProjects: [],
      linearTeams: [],
      hiddenLinearTeamIds: [],
      source: "github",
      filters,
      onChange,
      onLinearTeamsChange: () => {},
      onClose: () => {},
    }),
  );
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  expect(button, `Missing ${label} action`).toBeDefined();
  await act(async () => button!.click());
}

it("resets narrowed results to open items rather than exposing closed history", async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(container.querySelector("output")?.textContent).toBe("1,2");
  await click("Closed");
  expect(container.querySelector("output")?.textContent).toBe("1,2,3");
  await click("Clear filters");
  expect(container.querySelector("output")?.textContent).toBe("1,2");
  expect(inboxFetchState(loadInboxFilters())).toBe("open");
});

it("allows explicit all statuses and can reset that persisted choice", async () => {
  await act(async () => root.render(createElement(Harness)));
  await click("All statuses");
  expect(container.querySelector("output")?.textContent).toBe("1,2,3,4");
  expect(inboxFetchState(loadInboxFilters())).toBe("all");
  await act(async () =>
    root.render(createElement(Harness, { key: "reopened" })),
  );
  expect(container.querySelector("output")?.textContent).toBe("1,2,3,4");
  await click("Clear filters");
  await act(async () => root.render(createElement(Harness, { key: "reset" })));
  expect(container.querySelector("output")?.textContent).toBe("1,2");
});
