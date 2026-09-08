# Releases

Jayhun checks this public feed in packaged builds:

`https://github.com/kamafozilov/jayhun/releases/latest/download/latest.json`

The feed becomes available after the first draft release is published.
Only stable, published releases are offered to installed apps. Drafts stay private.
The update signature belongs to Jayhun, not upstream Monocode.

## Signing

The repository secret `TAURI_SIGNING_PRIVATE_KEY` signs update packages.
The public key is embedded in `src-tauri/tauri.conf.json`.
The local backup is `~/.config/jayhun/update-signing/updater.key`, readable only
by its owner. Keep an encrypted backup of this file outside the machine.
Do not commit or replace the key: installed versions trust its public key.
The key has no passphrase; GitHub encrypts the repository secret at rest.

For a signed local macOS build:

```bash
TAURI_SIGNING_PRIVATE_KEY="$HOME/.config/jayhun/update-signing/updater.key" \
  npm run tauri build -- --bundles app
```

Tauri signatures protect updates. These personal builds are not Apple
notarized and do not use Windows Authenticode signing. macOS or Windows may
require approval for the first installation. No Apple credentials are needed
for the updater signature.

## Prepare a release

1. Run `npm run set-version -- 0.1.42` with the next version.
2. Update `CHANGELOG.md` and `docs/release-notes.md`.
3. Commit and push the release changes.
4. Run **Build release** from GitHub Actions on that branch, or push the
   matching version tag. The workflow creates a draft, builds all four targets,
   and checks `latest.json` against the signed assets.
5. Install and test the package on each supported operating system before
   publishing the draft. Publishing activates the stable update feed.

Do not replace assets on a published release. Make a new version instead.
Linux automatic updates apply to AppImage installations. Debian packages use
manual package installation.

## Application behavior

Packaged builds check at startup and every six hours. Focus and network
reconnection trigger a check when that interval has elapsed. Checks have a
15-second timeout. The sidebar stays hidden if no update is available or a
background check fails. Settings retains manual checking.

Download and install are separate actions. The row shows byte progress, or an
indeterminate indicator when the server does not report the file size.
Restart to update installs the verified download. Download failures can be
retried. A failed relaunch can be retried without reinstalling the package.

Development builds do not download or install releases. Use Settings > General
> Preview update to simulate the progress row. Nothing runs automatically and
the demo never restarts the application.
