# Independent correctness and security review

Read for every candidate review or review-only assignment. Review the full diff against the actual base at the named head, relevant callers/contracts/persistence and the accepted brief. Inspect the tests and fixture provenance. Reports are claims requiring evidence; do not edit implementation or resolve uncertainty by changing requirements.

Search incident memory independently of the implementer's selection. Check applicable failure mechanisms against the diff and tests; record incident IDs, evidence and remaining gaps. Trace realistic lifecycle behavior, retries, concurrent work, rollouts, cancellation and recovery across layers. Do not stop at an assumption that another layer handles it.

## Correctness and scope

Assess design, required behavior, complexity, reusable patterns, compatibility/migrations, performance, test quality and adjacent regressions. Prefer clear demonstrated defects to speculative hardening. General findings should have meaningful impact; product-testing reports can separately include minor usability issues. A missing test is consequential when it leaves a specific important behavior unprotected.

Trace a bug from triggering input through effects and persistence. Distinguish introduced/worsened/pre-existing behavior and requirements uncertainty. Challenge unnecessary concepts and unrequested scope, not just code style. Recheck base integration and any post-review edits before readiness.

## Security coverage

Assess every changed part; keep a compact coverage ledger marking assessed/no identified risk, finding ID or unassessed with reason. Include applicable authentication, object ownership/tenant isolation, server-side authorization, input/query/output handling, secrets/privacy, state integrity/TOCTOU, transactions/idempotency, availability/abuse, dependencies/CI, browser/IPC/agent boundaries and tests that mask protections.

Use focused safe static/negative checks and current authoritative advisories where needed; never run live exploits merely to validate a finding. Do not print secrets. Include all severities of concrete security risks, including accepted and pre-existing ones encountered in scope. Avoid unrelated audits.

For each risk capture stable ID, severity, introduced/worsened/pre-existing provenance, file/line/head, attacker prerequisites and reachable path, assets/impact, evidence/uncertainty, mitigations, minimal remedy and disposition. Separate assessment gaps from proven vulnerabilities. Do not offer a numerical probability that code is safe.

Only the user may accept a disclosed security risk. Reuse an acceptance only for the same scope/conditions; expanded exposure requires a new decision. Silence, CI, a merge request or another agent's verdict is not acceptance. Record actual acceptance and its evidence/date/scope in the canonical private or approved task record; do not invent an owner, expiry or rationale. Accepted is not fixed.

## Result

Return prioritized findings, scope/security coverage, incident check dispositions, actual validation and limitations tied to head/base. `Ready` requires no unresolved blocking defects or unaccepted security concerns and no missing required evidence. Otherwise say what remains open. A complete review may still contain explicitly accepted risks; do not call it risk-free or 100% safe.

If publication is authorized, post one coherent review with useful inline anchors and refresh the PR head first. Follow the user's communication rules. A local-only review returns the same evidence without posting.
