# Jayhun

Jayhun is a desktop UI for coding agents, maintained by Kamron. It is a fork of
[MonoCode](https://github.com/hardbeat920/monocode) by Nick, built with React,
TypeScript, Tauri, and Rust.

It runs installed agent CLIs, including Claude Code, Codex, Cursor, Grok Build,
OpenCode, Pi, omp, and fx. Install and sign in to at least one provider before
starting a chat. Provider subscriptions and authentication stay with those CLIs.

## Local development

Use Node.js 24, npm, and Rust stable. The repository includes `.nvmrc` and
`rust-toolchain.toml`. On macOS, install Xcode Command Line Tools. On Linux, run
`npm run setup:linux:deb` on Debian or Ubuntu to install native dependencies.

```bash
npm ci
npm run tauri dev
```

`npm run dev` starts only the frontend. Use `npm run tauri dev` for the desktop
app and its native features. `npm run tauri:stable` runs without Rust file watching.

## Checks and builds

```bash
npm run check
npm run build
npm run tauri build -- --bundles app
```

The last command builds a macOS app at `target/release/bundle/macos/Jayhun.app`.
For Linux packages, run `npm run build:linux`. For Windows, run
`npm run build:windows` in a Windows environment.

GitHub CI runs frontend and Rust checks on macOS, Linux, and Windows.
It also supports manual runs from the Actions tab.
The manual **Build packages** workflow creates downloadable build artifacts.
It does not publish releases. Builds are not notarized or signed for public
distribution. Automatic updates are not configured. Public releases and update
signing will be configured when distribution is needed.

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
It does not import existing MonoCode sessions. The inherited icon assets remain
in use until a Jayhun icon is designed. `CHANGELOG.md` records inherited history.

## License

[MIT](LICENSE). The original copyright notice is retained.
See [NOTICE](NOTICE) for attribution and provider trademark notices.
