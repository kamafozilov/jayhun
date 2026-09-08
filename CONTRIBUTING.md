# Contributing to Jayhun

Keep each change focused. Discuss large product or architecture changes with
Kamron before implementation.

## Development

Follow the setup commands in [README.md](README.md).

- `src/chrome/` contains the window frame, sidebar, composer, and tabs.
- `src/surfaces/` contains transcripts, editors, diffs, and terminals.
- `src/lib/harness/` contains provider adapters and protocol parsing.
- `src-tauri/src/` contains native processes, filesystem access, Git, and storage.

## Before pushing

Run `npm run check` and `npm run build`. For UI changes, also open the desktop
app and verify the changed flow. Keep file contents and commit messages in English.
Use Conventional Branch names and Conventional Commits. Preserve attribution
when importing upstream code.

A pull request should state what changed, why, and how it was tested.
