# StockWise GitHub course mirrors

**Canonical source:** `athikarn5678/stockwise` (public, `main`). Develop and push here only.

**Private destination repositories:**
- `athikarn5678/stockwise-cloud-computing-06016404` — 06016404 CLOUD COMPUTING
- `athikarn5678/stockwise-server-side-web-development-06016418` — 06016418 SERVER-SIDE WEB DEVELOPMENT

The workflow `.github/workflows/sync-course-repositories.yml` runs after each canonical `main` push (and manually via `workflow_dispatch`). It **fetches the canonical repository's complete Git commit history** into both course repositories, then creates a merge commit whose second parent is the exact source commit. Every canonical commit, including all historical commits, remains reachable in each course repo without force-pushing or rewriting their existing history.

The checked-out file tree is copied from the canonical source with just one exception: the **root `README.md`** is generated using the stable subject-specific header in `.github/course-readmes/*.md` plus the entire canonical README body. These headers never need manual updates.

## One-time GitHub setup

1. Audit the complete working tree and all Git history for actual secrets and unintended public files; do not blindly include local scratch/debug files.
2. Create `athikarn5678/stockwise` **public** and both course repos **private**, each with an initialized `main` branch. Do not fork the public repo.
3. Generate a **fine-grained personal access token** limited to the two private course repositories, with **Contents: Read and write** and **Workflows: Read and write** (the mirrored tree contains GitHub Actions workflows). Set an expiry and rotate before expiry.
4. In the **public** source repo: Settings → Secrets and variables → Actions → New repository secret, named exactly `COURSE_SYNC_TOKEN`. Never place the token in source, logs, or chat.
5. Point local `origin` to the canonical source. Commit only reviewed files and push `main`. Inspect the `Sync course repositories` Actions result and both private destinations.
6. Re-run the sync workflow through GitHub Actions if a temporary error occurs.

## History, behavior and limits

- **All canonical source commits are retained verbatim as historical ancestors** of destination `main`. Their original SHA-1s and file trees are preserved.
- The two private destinations have their own additional sync merge commits and initial course-repository commits. Their `main` HEAD SHA is therefore different from the canonical `main` HEAD; this is unavoidable when their root README differs.
- Files in each destination's final tree match the source except the root `README.md`. The subject-specific README header remains stable, while its shared StockWise body updates automatically.
- The sync workflow is gated to only run in the canonical source repository. The two course repos do not trigger recursive sync jobs.
- Any manual changes in destination repositories are overwritten in the next successful sync. Make all changes in the canonical repository.
- If a push fails in one destination, the other may have succeeded; updates are not atomic. Check Actions statuses, then retry.
- Private destinations are expected to have existing `main` branches. No force-push is used; existing course repo commits are retained in the merged history.
