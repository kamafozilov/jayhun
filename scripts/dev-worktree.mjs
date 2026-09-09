import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

export function normalizeGitPath(path, platform = process.platform) {
  // Git and Node can disagree about drive-letter case on Windows.
  return platform === "win32" ? path.replaceAll("\\", "/").toLowerCase() : path;
}

export function worktreeIdentity(root) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const gitDir = normalizeGitPath(
    realpathSync.native(git("rev-parse", "--absolute-git-dir")),
  );
  const commonDir = normalizeGitPath(
    realpathSync.native(resolve(root, git("rev-parse", "--git-common-dir"))),
  );
  // Windows can expose the same directory through short names or aliases.
  const gitStat = statSync(gitDir, { bigint: true });
  const commonStat = statSync(commonDir, { bigint: true });
  if (gitStat.dev === commonStat.dev && gitStat.ino === commonStat.ino)
    return null;
  const digest = createHash("sha256").update(gitDir).digest();
  const branch =
    git("branch", "--show-current") ||
    `detached-${git("rev-parse", "--short", "HEAD")}`;
  return {
    id: digest.toString("hex").slice(0, 32),
    branch,
    port: 20000 + (digest.readUInt32BE(0) % 20000),
  };
}

export function devConfig(base, identity, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      "JAYHUN_DEV_PORT must be an integer between 1024 and 65535",
    );
  }
  const config = {
    build: { devUrl: `http://localhost:${port}` },
    app: {
      security: {
        devCsp: base.app.security.devCsp.replaceAll(":1420", `:${port}`),
      },
    },
  };
  if (identity) {
    config.identifier = `${base.identifier}.worktree.w${identity.id}`;
    config.app.windows = base.app.windows.map((window) => ({
      ...window,
      title: `${base.productName} [${identity.branch}]`,
    }));
  }
  return config;
}

export async function assertPortAvailable(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        new Error(
          `Dev port ${port} is unavailable (${error.code}). Stop the other server or set JAYHUN_DEV_PORT to a free port.`,
        ),
      ),
    );
    server.listen({ port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

export function readBaseConfig(root) {
  return JSON.parse(
    readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
}
