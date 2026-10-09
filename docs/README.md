# StockWise documentation

Canonical documents each own one topic. Use the
[repository README](../README.md) for the project entry point and repository layout.

## Root authorities

- [Build specification](../BUILD_SPEC.md) — scope, requirements, roles, and master open questions.
- [Developer guide](../AGENTS.md) — execution rules, local setup, verified commands, and Definition of Done.
- [Project plan](../PROJECT_PLAN.md) — delivery order and current status.
- [Use cases](../USE_CASE_SPECS.md) — user- and system-visible behavior and failures.

## Architecture

- [System architecture](architecture/ARCHITECTURE.md) — boundaries, responsibilities, data flows, and conceptual deployment.
- [Database contract](architecture/DATABASE.md) — schema, constraints, lifecycle, and transaction invariants.
- [Decision log](architecture/DECISIONS.md) — accepted ADRs and their rationale.

## Contracts

- [REST API](contracts/API.md) — HTTP resources, representations, authorization, and errors.
- [Analytics and forecasting](contracts/ANALYTICS.md) — metric formulas, reporting periods, forecasts, reorder policy, and AI snapshot contract.

## Development

- [Fixed demo dataset](development/DEMO_DATA.md) — guarded local demo provisioning and validation.
- [Authentication integration harness](development/AUTH_INTEGRATION_HARNESS.md) — private recording mail, disposable ownership guards, artifact boundaries, and separately authorized execution.

Task, evidence, testing, audit, remediation, and acceptance records are maintained
outside Git in the StockWise Obsidian project records. Follow the
[documentation location policy](../AGENTS.md#documentation-location-policy).
