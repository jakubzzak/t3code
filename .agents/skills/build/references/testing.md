# Product acceptance

Read for baseline, post-implementation and testing-only work. The tester reports and does not repair implementation, tracked tests, snapshots or configuration.

Create a scenario ledger covering every changed feature/entry point/option and relevant adjacent behavior. Record requirement/assumption, preconditions, fixture provenance, ordered actions, meaningful expected/actual outcomes, revision, evidence and status (`passed`, `failed`, `blocked`, `not run`). Explain exclusions. Inspect the actual test assertions and data, not just filenames or coverage totals.

Read the incident registry yourself, including the lead's selected records and an independent search of changed components and mechanisms. For each relevant incident, include the known-bad input, expected invariant, regression check and evidence. A fixed incident remains relevant as a regression case. A historical anecdote alone is not proof the current code fails.

## Execute the behavior

- Capture/reuse reproducible before and after behavior. If baseline is missing, use an isolated base checkout with separate local state; never run old code against shared writable data. For new features label prior absence honestly.
- Use real routes and the host-approved browser/CLI/API workflow, supported roles and fixtures. Assert state at meaningful steps, persistence after reload and downstream effects, not merely successful clicks.
- Exercise applicable alternate/cancel/undo/retry/duplicate-submit/error/interruption/permission paths. Include accessibility, narrow screens and important loading/empty states where relevant.
- Assess clarity of actions, copy, feedback, density and layout as well as functional outcomes. Report concrete minor UI issues; do not silently turn preference into a requirement.
- For persisted-data changes, use representative old/new cohorts under data.md, with baseline fidelity and deploy-window compatibility. Synthetic happy-path fixtures alone do not meet this gate.
- Run only focused existing tests/probes. Verify the test selection cannot expand into a whole local suite. A probe using stubs cannot claim real-service or end-to-end coverage.

## Report

Give findings with severity, reproduction, expected/actual result, evidence and corrective direction; identify requirement uncertainties separately. Record missing critical unit/integration/E2E coverage with the actual unprotected behavior.

Return `passed` only when required scenarios and critical-path evidence exist; otherwise `issues found` and/or `incomplete`. Human sign-off must be actual, never inferred from an agent run. Pass findings to the lead for separate authorized remediation, then repeat the affected acceptance scenarios.
