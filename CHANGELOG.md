# Jayhun changelog

## [Unreleased]

### Fixed
- Add an OMP conversation-language instruction to reduce unrequested language switches in progress updates and replies, including resumed chats.
- Preserve the last saved default provider and per-provider models across desktop development, worktrees, and releases, loading them before session creation.
- Use Codex when no default provider has been saved, without overriding an explicit choice.
- Avoid opening Cursor login during background model catalog discovery.
- Restore open issues and draft/open pull requests when clearing inbox filters; keep all statuses as an explicit choice, including from an empty inbox.

## [0.1.43] - 2026-09-09

### Added
- OMP Fast mode with backend-confirmed preferences and retryable setting failures.

### Changed
- Document independent Jayhun development and selective external fixes; retire the inherited project changelog from maintained documentation.
- Use pinned pnpm 11.22.0 for dependency installation, development, CI, and releases.
- Check for updates 15 seconds after startup and every four minutes in packaged builds.
- Dismiss the installed update card after closing its release notes.
- Widen the release notes dialog and size it to its content.
- Avoid redundant Explorer row renders and file icon SVG replacements during unrelated updates.
- Keep the Changes panel header stable when diff totals change.

### Fixed
- Show signature verification separately from download progress before allowing an update restart.
- Keep downloads with an unknown size from appearing complete.
- Remove empty updater footer spacing while preserving background checks, update notices, download verification, and explicit restart.

## [0.1.42] - 2026-09-09

### Fixed
- Answer Codex questions from the composer.
- Keep pending workspace saves when chat state changes, so closed files stay closed after restoration.
- Hide repeated Codex skills budget notices from new and saved conversations.
- Keep the sidebar at least 280 pixels wide.
- Add a stable Jayhun development launcher with a Linux WebKit rendering workaround.

## [0.1.41] - 2026-09-09

### Added
- Signed Jayhun update packages and a draft release workflow for all desktop targets.
- Inline download progress and an explicit restart action.
- Development-only update preview in Settings.

### Changed
- Hide the sidebar update row until an update is available.
- Share update progress across Settings and the sidebar.
- Check for updates at startup and every six hours in packaged builds.

## [0.1.40] - 2026-09-09

### Added
- Jayhun application name, app identifier, and separate local storage.
- A Jayhun icon for the desktop app, web interface, and Windows installer.
- Local development instructions and CI checks for macOS, Linux, and Windows.

### Changed
- Use the Jayhun repository for updates and development.
