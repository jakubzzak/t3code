# Investigation-first bug mode (legacy Fixit)

Use for a demonstrated bug or an explicit `$fixit` request routed to Build. No feature spec is required. Investigation-only and local-only restrictions persist. A question about a bug is not permission to implement it.

## Investigate before editing

Read the report and relevant screenshots, logs, permitted production data, error-tracker events, previous issues/fixes and actual deployment history. Use available relevant sources; do not mistake a missing connector for proof that an approved CLI is unavailable. Never change production or incident/tracker state merely to investigate.

Establish expected/observed behavior and a causal chain through code, stored data and the actual deployed version. Reproduce where possible. Separate confirmed facts, hypotheses and unavailable evidence; recency alone is not attribution. Determine first observed versus actual onset, single observed occurrence versus recurrence, and confirmed affected versus potentially exposed customers. Count distinct customers using a verified domain identity; label samples, bounds and estimates. Widen the investigation when recent releases do not explain the cause.

Before implementation, report:

- Cause, evidence, uncertainty and diagnosis confidence.
- Observed occurrence/recurrence, time window, affected/potential population and counting limitations.
- Ranked plausible triggering deployments/changes, supporting and contradictory evidence and attribution confidence. A merge timestamp is not a release timestamp.
- Repair alternatives: simple manual correction, migration/backfill, code correction or combination. Distinguish fixing the cause, repairing existing damage and remaining customer consequences. Prefer a sufficient manual correction over manufacturing code changes.
- The proposed minimal fix, expected effect, focused regression proof, confidence in that remedy, risks and unresolved decisions.

## Preserve the legacy Fixit decision boundary

For an explicit legacy `$fixit` request, retain its original autonomous code-fix gate: the proposed remedy's confidence must be strictly greater than 95% after the report. At or below 95%, continue investigation or obtain explicit authorization for that disclosed remedy before implementation. Existing approval given before the lower-confidence proposal was disclosed is insufficient. Confidence is subjective, not a measured probability or a production-write permission; never inflate it to cross the threshold. Diagnosis, attribution and remedy confidence are different claims.

For ordinary Build bug work, follow the actual approved implementation scope and evidence requirements; do not impose a percentage ritual on unrelated features. A product/design/storage ambiguity still requires a decision. No confidence value bypasses required tests, review or safety boundaries.

## Minimal correction and validation

Make the smallest correction that solves the demonstrated failure. No refactoring, speculative hardening or unrelated cleanup; ask before broad restructuring. Capture a meaningful failing baseline and prove the fix plus adjacent behavior. Consult incident memory, product acceptance, data compatibility and independent review. Passing focused checks does not establish production recovery.

## Manual data repair

Read data.md and the repository's migration HOWTO. Production migration execution is excluded from this bug mode. Prepare a reviewable manual artifact when authorized; investigation-only excludes executable repair artifacts unless expressly requested.

Report observed/eligible/already-correct/excluded records, distinct customers, predicted before/after fields, expected matches versus modifications, skips/conflicts and residual work. Explain overlap and unknown counts, snapshot time, predicates and freshness limits. Unknown values block affected records; a safe subset is acceptable only when independent selection and invariants are proven. If selection or shared invariants are uncertain, block the artifact.

For MongoDB manual repairs inherited from Fixit, deliver one complete immediately invoked anonymous arrow function (async if needed), with configuration/helpers inside, dry-run by default and an explicit internal apply switch. Respect the actual shell and repository's stricter paste/syntax rules. No imports, credentials, external helpers or top-level await. Use bounded processing, expected-state write guards, narrow intended updates, safe reruns and truthful partial-progress/conflict counts. Verify actual persisted results and explain zero modifications. Test the exact artifact in isolation; syntax checks alone are insufficient.

Give exact run steps, target, prerequisite deployment/backup/rehearsal evidence, expected state/counts and read-only post-run checks. Recovery must preserve subsequent legitimate changes; do not invent backups or reversibility. Preparing or publishing the artifact is not permission to apply it. A script-only remedy needs explicit publication scope; do not invent an application change just to open a PR.

## Handoff

Return to Build's review, acceptance and PR-feedback stages with investigation evidence, no-refactor scope and manual repair dependencies intact. A legacy `$fixit` request authorizes that PR-ready handoff unless narrowed, but not merge/release or production writes. Ship requires its own established authority. Distinguish PR readiness, pending manual repair and verified production resolution.
