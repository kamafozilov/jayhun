# Jayhun

Jayhun is an independently maintained desktop UI for coding agents by Kamron,
built with React, TypeScript, Tauri, and Rust.

It runs installed agent CLIs, including Claude Code, Codex, Cursor, Grok Build,
OpenCode, Pi, omp, and fx. Install and sign in to at least one provider before
starting a chat. Provider subscriptions and authentication stay with those CLIs.

OMP chats include an instruction to keep replies and progress updates in the user's
language and script, unless another language is explicitly requested. This also
applies to resumed chats; code, commands, and literal UI labels stay unchanged.
It guides model behavior rather than translating or filtering generated text.

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
metadata. Each worktree owns its chat database, window settings, WebView storage,
and Rust build output. Provider defaults are shared (see below). The window title includes the branch name. Detached
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

### Default provider and model

Settings → Providers → **Use by default** saves the provider and its model for
new conversations. Desktop development builds, linked worktrees, and releases
share this choice in `dev.kamafozilov.jayhun/model-preferences.db` under the
platform's user data directory. Changing a development port or installing an
update does not reset it. Other workspace data remains isolated.

The shared preferences load before sessions are created. Existing browser-local
defaults migrate when that origin first opens the updated app; once a shared
default exists, stale local defaults cannot overwrite it. An installation with
no saved choice starts with Codex. Catalog discovery does not initiate Cursor
login; interactive Cursor use still supports authentication.

Changes reach other windows immediately and separate app instances when they
regain focus. Frontend-only browser previews (`pnpm run dev`) still use
origin-local storage because they do not have the desktop persistence backend.

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

## Project development

Jayhun has its own product direction, release cycle, application identity, and
update signing key. Building and running it does not require access to the
original project's repository.

- Develop against `main` in `https://github.com/kamafozilov/jayhun`.
- Use focused `feat/`, `fix/`, or `chore/` branches and Conventional Commits.
- Review and test changes before merging. See [Contributing](CONTRIBUTING.md).
- Import external fixes only when they benefit Jayhun; follow the source and
  license tracking procedure in [Contributing](CONTRIBUTING.md#importing-external-changes).

Jayhun uses the app identifier `dev.kamafozilov.jayhun` and its own storage keys.
Existing data from other applications is not imported automatically.
The source icon is `public/jayhun.svg`. Run `node scripts/generate-icons.mjs`
on macOS to rebuild desktop icon assets.
`CHANGELOG.md` contains Jayhun's release history.

## Origin and license

Jayhun began from [MonoCode](https://github.com/hardbeat920/monocode) by Nick
and now develops independently. The original Git history and copyright notice
are preserved. Earlier project documentation remains available in Git history.

[MIT](LICENSE). The original copyright notice is retained.
See [NOTICE](NOTICE) for attribution and provider trademark notices.
