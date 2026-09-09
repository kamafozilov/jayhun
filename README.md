# Jayhun

Jayhun is a desktop UI for coding agents, maintained by Kamron. It is a fork of
[MonoCode](https://github.com/hardbeat920/monocode) by Nick, built with React,
TypeScript, Tauri, and Rust.

It runs installed agent CLIs, including Claude Code, Codex, Cursor, Grok Build,
OpenCode, Pi, omp, and fx. Install and sign in to at least one provider before
starting a chat. Provider subscriptions and authentication stay with those CLIs.

## Local development

Use Node.js 24, pnpm 11.22.0, and Rust stable. The pnpm version is pinned in
`package.json`; Node and Rust versions are in `.nvmrc` and `rust-toolchain.toml`.
If pnpm is not installed, run `npm install --global pnpm@11.22.0`.
On macOS, install Xcode Command Line Tools. On Linux, run
`pnpm run setup:linux:deb` on Debian or Ubuntu to install native dependencies.

```bash
pnpm install --frozen-lockfile
pnpm start
```

Dependency install scripts require approval in `pnpm-workspace.yaml`. Only the
locked esbuild version is approved; review a dependency's install script before
approving a new version.

`pnpm start` opens the desktop app with frontend and Rust file watching disabled.
It uses the same configuration as `pnpm run tauri:stable`.

On Linux, the launcher defaults `WEBKIT_DISABLE_DMABUF_RENDERER` to `1`.
This works around a WebKit rendering issue that can cause an empty window or
`Error 71 (Protocol error)` on Wayland. It preserves an existing value and does
not change the environment on macOS or Windows. Packaged builds are unaffected.
See the [WebKit issue](https://bugs.webkit.org/show_bug.cgi?id=291332).

To try the default WebKit renderer again on Linux:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=0 pnpm start
```

### Parallel worktree development

Run `pnpm start` or `pnpm run tauri:stable` in each linked Git worktree.
The launcher assigns a stable port and app identifier from the worktree's Git
metadata. Each worktree owns its chat database, app settings, WebView storage,
and Rust build output. The window title includes the branch name. Detached
worktrees show their short commit ID. Switching branches or moving a worktree
with `git worktree move` keeps its identity; removing and recreating it may not.
The primary checkout keeps port 1420 and its existing app data.

Linked worktrees default to two Cargo build jobs to limit concurrent CPU and
memory use. Set `CARGO_BUILD_JOBS` to override this limit. pnpm reuses downloaded
packages through its machine-wide store; Cargo keeps its normal machine cache.
Do not share `node_modules` or `target` between worktrees: branches can need
different dependencies and executables.

If a port is occupied, the launcher stops before starting Tauri. Stop that
server or choose a free port, for example on macOS or Linux:

```bash
JAYHUN_DEV_PORT=24001 pnpm start
```

Keep an override consistent: browser storage is also scoped to the dev URL.
Use macOS 14 or newer for separate persistent WebView data stores. Agent CLI
accounts remain shared on the machine; this isolates Jayhun data, not provider
credentials. Quit each dev app before removing its worktree. App data outside
the checkout stays on disk after worktree removal.

The direct `pnpm run tauri dev` command bypasses this launcher. Use it for a
single development instance. Worktree setup should only install dependencies
with `pnpm install --frozen-lockfile` and `cargo fetch --locked`; launch apps
separately when needed.

For development with file watching, use `pnpm run tauri dev`. On affected Linux
machines, use `WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm run tauri dev`.
`pnpm run dev` starts only the frontend, without native desktop features.

## Checks and builds

```bash
pnpm run check
pnpm run build
TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' \
TAURI_SIGNING_PRIVATE_KEY="$HOME/.config/jayhun/update-signing/updater.key" \
  pnpm run tauri build --bundles app
```

The last command builds a macOS app at `target/release/bundle/macos/Jayhun.app`.
For Linux packages, run `pnpm run build:linux`. For Windows, run
`pnpm run build:windows` in a Windows environment.

GitHub CI runs frontend and Rust checks on macOS, Linux, and Windows.
It also supports manual runs from the Actions tab.
The **Build release** workflow creates a draft release with signed update
packages for Apple Silicon, Intel macOS, Linux x64, and Windows x64.
It verifies the update feed before the draft is ready to publish.
See [Release setup](docs/releases.md) for signing, builds, and publishing.

## Git workflow

- `origin` fetches from `https://github.com/kamafozilov/jayhun.git`.
  Pushes use `git@github.com:kamafozilov/jayhun.git` through SSH.
- `upstream` points to `https://github.com/hardbeat920/monocode.git`.
- Start changes from `main` on a `feat/`, `fix/`, or `chore/` branch.
- Run the relevant checks before committing. Use Conventional Commits.

To review upstream changes without applying them:

```bash
git fetch upstream
git log --oneline main..upstream/main
```

Merge selected upstream changes on a separate branch and test before merging
into `main`. Preserve the original Git history and license.

Jayhun uses the app identifier `dev.kamafozilov.jayhun` and its own storage keys.
It does not import existing MonoCode sessions. The source icon is `public/jayhun.svg`.
Run `node scripts/generate-icons.mjs` on macOS to rebuild desktop icon assets.
`CHANGELOG.md` contains Jayhun release notes. The original release history is
preserved in `docs/upstream/monocode-changelog.md`.

## License

[MIT](LICENSE). The original copyright notice is retained.
See [NOTICE](NOTICE) for attribution and provider trademark notices.
