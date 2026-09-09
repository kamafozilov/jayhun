import { run } from "@tauri-apps/cli";

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
]);
