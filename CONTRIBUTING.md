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

Run `pnpm run check` and `pnpm run build`. For UI changes, also open the desktop
app and verify the changed flow. Keep file contents and commit messages in English.
Use Conventional Branch names and Conventional Commits.

A pull request should state what changed, why, and how it was tested.

## Importing external changes

External repositories are optional sources of fixes, not a synchronization
target. Jayhun's roadmap and releases are maintained here; there is no routine
upstream merge requirement.

1. Select the source commit and review its dependencies, license, and relevance.
   Fetch only the branch needed for review, without importing or pruning tags:

   ```bash
   git fetch --no-tags --no-prune --no-prune-tags <source-url> <source-branch>
   git log --oneline main..FETCH_HEAD
   git show <source-commit>
   ```

2. Create a focused branch from Jayhun's `main`. For a compatible, self-contained
   commit, use `git cherry-pick -x <source-commit>`. Otherwise port the behavior
   to the current architecture rather than overwriting Jayhun's implementation.
3. Record the source repository URL, full commit SHA, adaptations, and validation
   in the PR. Retain that provenance in the final commit message, including when
   squash-merging. Preserve authorship for cherry-picks and applicable copyright
   and license notices for all imported code.
4. Verify the affected behavior and run the checks above before merging.
   Keep Jayhun's app identifier, storage isolation, release URLs, and signing
   key unless the change explicitly includes a planned migration.

Do not rewrite published history or create ancestry-only merges to mark
unreviewed changes as integrated. A source commit being absent from Jayhun's
history is not, by itself, a reason to import it.
