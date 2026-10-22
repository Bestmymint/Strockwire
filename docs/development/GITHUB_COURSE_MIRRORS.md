# StockWise GitHub course mirrors

**Canonical source:** `athikarn5678/stockwise` (public, `main`). Edit and push here only.

The two course repositories must remain **private**:

- `athikarn5678/stockwise-cloud-computing-06016404` — 06016404 CLOUD COMPUTING
- `athikarn5678/stockwise-server-side-web-development-06016418` — 06016418 SERVER-SIDE WEB DEVELOPMENT

The workflow `.github/workflows/sync-course-repositories.yml` runs after each `main` push to the canonical repository and on manual `workflow_dispatch`. It copies the exact checked-out repository contents to each course repository, replacing **only the root `README.md`** with its fixed subject header plus the canonical `README.md`. Headers are stored at `.github/course-readmes/*.md` and do not need manual editing for later syncs.

## One-time GitHub setup

1. Confirm that the complete working tree **and Git history** are safe to publish publicly; explicitly examine ignored files, accidental secrets, scratch/debug files, hardcoded tokens, and any sensitive historical commits. Do not stage everything blindly from the currently dirty worktree.
2. Create `athikarn5678/stockwise` as **public** with `main`, and both course repositories as **private** with `main`. Initialize course repositories with a README so that their `main` branches exist before first sync. Do not create them as forks.
3. Generate a **fine-grained GitHub personal access token** whose repository access is limited to the **two private course repositories**, with repository **Contents: Read and write** and **Workflows: Read and write** (needed because the mirrored tree contains `.github/workflows`). Use an expiration and rotate before expiry. Do not paste the token in chat or write it to a file.
4. In the **public** source repository: Settings → Secrets and variables → Actions → New repository secret. Name it exactly `COURSE_SYNC_TOKEN`, and enter the token value.
5. Set the local repository's `origin` to the canonical source when the public-history audit is complete. Commit only deliberately reviewed files and push `main`.
6. Verify the `Sync course repositories` workflow run and inspect both private repositories. Use Actions → workflow → Run workflow to retry after correcting any issue.

## Guarantees and limitations

- All committed files are mirrored, including workflows and documentation. The root README is the only intended file-content difference. Course headers remain stable while the canonical README body tracks the main project automatically.
- The workflow runs **only** on the canonical `athikarn5678/stockwise` repository; its copies in course repositories will not fan out.
- Destination-only edits and files (other than the protected root README) are overwritten/deleted by the next successful sync. Do not work directly in the course repositories.
- Repos have independent commit histories and different commit SHAs. A single push does not make the three remote updates atomic: review Actions status and rerun failures as necessary.
- Empty/uninitialized course repositories cannot be cloned with `--branch main`. Initialize each as instructed.
- The workflow must have access to `COURSE_SYNC_TOKEN` to write cross-repository; the default `GITHUB_TOKEN` is not sufficient. Avoid secrets in source/commit history.
- The sync job intentionally does not run on the course repositories (but other copied CI workflows may).
