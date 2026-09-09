import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  worktreeIdentity,
  devConfig,
  assertPortAvailable,
  readBaseConfig,
} from "./dev-worktree.mjs";

const base = readBaseConfig(fileURLToPath(new URL("../", import.meta.url)));

test("linked worktrees keep separate identities across branch switches and moves", () => {
  const root = mkdtempSync(join(tmpdir(), "jayhun-worktrees-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init", "--initial-branch=main");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "test",
    );
    const first = join(root, "first worktree");
    const second = join(root, "second");
    git("worktree", "add", "-b", "feat/first", first);
    git("worktree", "add", "--detach", second);
    assert.equal(worktreeIdentity(root), null);
    const one = worktreeIdentity(first);
    const two = worktreeIdentity(second);
    assert.equal(one.branch, "feat/first");
    assert.match(two.branch, /^detached-/);
    assert.notEqual(one.id, two.id);
    execFileSync("git", ["switch", "-c", "fix/renamed"], {
      cwd: first,
      stdio: "pipe",
    });
    const moved = join(root, "moved");
    git("worktree", "move", first, moved);
    const renamed = worktreeIdentity(moved);
    assert.equal(renamed.id, one.id);
    assert.equal(renamed.port, one.port);
    assert.equal(renamed.branch, "fix/renamed");
    assert.equal(worktreeIdentity(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dev overrides align frontend, CSP and storage without changing packaged config", () => {
  const snapshot = JSON.stringify(base);
  const identity = {
    id: "0123456789abcdef0123456789abcdef",
    branch: "feat/example",
  };
  const config = devConfig(base, identity, 23456);
  assert.equal(config.build.devUrl, "http://localhost:23456");
  assert.match(config.app.security.devCsp, /ws:\/\/localhost:23456/);
  assert.ok(!config.app.security.devCsp.includes(":1420"));
  assert.equal(
    config.identifier,
    "dev.kamafozilov.jayhun.worktree.w0123456789abcdef0123456789abcdef",
  );
  assert.equal(config.app.windows[0].title, "Jayhun [feat/example]");
  assert.equal(config.app.windows[0].width, base.app.windows[0].width);
  assert.equal(JSON.stringify(base), snapshot);
  const primary = devConfig(base, null, 1420);
  assert.equal(primary.identifier, undefined);
  assert.equal(primary.app.windows, undefined);
  assert.equal(primary.app.security.devCsp, base.app.security.devCsp);
  for (const port of [0, NaN, 65536, 1420.5])
    assert.throws(() => devConfig(base, identity, port));
});

test("an occupied port fails before Tauri can attach to another frontend", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await assert.rejects(assertPortAvailable(port), /JAYHUN_DEV_PORT/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await assertPortAvailable(port);
});
