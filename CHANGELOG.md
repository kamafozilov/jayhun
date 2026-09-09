# Jayhun changelog

## [Unreleased]

### Changed
- Check for updates 15 seconds after startup and every four minutes in packaged builds.
- Dismiss the installed update card after closing its release notes.
- Widen the release notes dialog and size it to its content.

### Fixed
- Show signature verification separately from download progress before allowing an update restart.
- Keep downloads with an unknown size from appearing complete.

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
