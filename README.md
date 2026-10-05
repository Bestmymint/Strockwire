# StockWise

StockWise is a retail platform for SMEs with organization-level catalog and
supplier management, branch inventory, purchasing, POS and sales, deterministic
analytics and forecasting, and scheduled aggregate AI summaries.

The repository is a pnpm workspace containing a Next.js web application and an
Express TypeScript modular monolith backed by PostgreSQL and Prisma.

## Start here

- [Documentation index](docs/README.md) — architecture, contracts, decisions, and development guides.
- [Build specification](BUILD_SPEC.md) — product scope, requirements, roles, and open questions.
- [Project plan](PROJECT_PLAN.md) — delivery order and current status.
- [Use cases](USE_CASE_SPECS.md) — behavior, alternative flows, and failures.
- [Developer guide](AGENTS.md#14-commands-and-environment-setup) — prerequisites, local setup, verified commands, and execution rules.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Next.js UI and application-local tests |
| `apps/api/` | Express modules, Prisma schema/migrations, and application-local tests |
| `docs/` | Canonical technical documentation |
| `test/` | Root tooling smoke test |
| `tests/e2e/` | Cross-application Playwright tests and fixtures |
| `.github/workflows/` | CI quality gates |

Root configuration files own the workspace, local PostgreSQL Compose setup,
and shared build, formatting, linting, and test tooling. Generated outputs and
populated environment files are ignored. `packages/` and `infra/` are reserved
boundaries; neither directory currently exists.

Task, evidence, audit, and acceptance records belong in the external StockWise
Obsidian project records; repository documentation follows the
[documentation location policy](AGENTS.md#documentation-location-policy).
