import { run } from "@tauri-apps/cli";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  worktreeIdentity,
  devConfig,
  assertPortAvailable,
  readBaseConfig,
} from "./dev-worktree.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const identity = worktreeIdentity(root);
const port = Number(process.env.JAYHUN_DEV_PORT ?? identity?.port ?? 1420);
const config = devConfig(readBaseConfig(root), identity, port);
await assertPortAvailable(port);
process.env.JAYHUN_DEV_PORT = String(port);
process.env.VITE_JAYHUN_WORKTREE = identity?.branch ?? "";
if (identity) {
  // Each checkout owns its build output, even if the shell shares a Cargo target.
  process.env.CARGO_TARGET_DIR = resolve(root, "target");
  process.env.CARGO_BUILD_JOBS ??= "2";
}
console.log(
  `Jayhun${identity ? ` [${identity.branch}]` : ""}: http://localhost:${port}`,
);
console.log(
  `App data identifier: ${config.identifier ?? readBaseConfig(root).identifier}`,
);

// Avoid WebKit blank windows and Wayland protocol errors on affected Linux GPUs.
// Preserve explicit overrides for systems where DMABUF works.
if (process.platform === "linux") {
  process.env.WEBKIT_DISABLE_DMABUF_RENDERER ??= "1";
}

await run([
  "dev",
  "--no-watch",
  "--config",
  "src-tauri/tauri.stable.conf.json",
  ...process.argv.slice(2),
  "--config",
  JSON.stringify(config),
]);
