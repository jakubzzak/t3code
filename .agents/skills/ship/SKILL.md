---
name: ship
description: Merge an authorized ready change, verify its deployed version and customer behavior, schedule production follow-up, and recover within agreed limits. Also verifies a user-merged release; reading or editing this skill does not authorize release.
---

# Ship

Merged is not delivered. Own the authorized change through production evidence and a clear observation outcome.

Read [the delivery contract](../build/references/contract.md) and [incident memory](../build/references/incidents.md). Confirm existing merge/release authority, target, dependencies and recovery scope. Honor narrower verification-only requests. No arbitrary production writes or customer transactions. Data migrations require separate explicit scope, exact reviewed artifact and supported execution; naming a script in a brief is insufficient.

## 1. Recheck readiness and merge

Read Build's evidence, current PR head/base, actual required checks and human-review rules, unresolved findings, relevant incidents and migration prerequisites. Evaluate changes since review. Do not merge on stale evidence, accepted uncertainty disguised as a pass, or an administrator bypass.

Merge only through the supported PR/queue mechanism with an expected-head guard when available. Verify the merged result; queued is not merged. If the user already merged, inspect the actual result and continue verification rather than repeating the merge. Missing pre-release evidence remains a gap and calls for proportionate investigation, not retroactive claims of safety.

## 2. Follow deployment and operational dependencies

Identify the deployment associated with the actual merge/squash/queue commit, follow it, and prove which artifact is running in the target environment. A branch tip, merge time or successful frontend preview does not prove the backend version.

Apply the agreed compatibility order for code/data rollout. For any manual migration, read [the data rules](../build/references/data.md); prepare exact steps and verify operator results. Do not silently execute a manual-only procedure or release past a blocking dependency. If an apply may already have run, establish its artifact/scope/results before proposing another run.

Report deployment failure with evidence; avoid blind retries. If the release needs a user-only step, mark `release pending` and name it.

## 3. Immediate verification

Run the agreed customer/operator/API scenario against the confirmed artifact. Use read-only probes or explicitly authorized test accounts and reversible fixtures; login alone does not authorize business transactions. Compare baseline errors, affected-service logs and relevant data invariants. Verify both the intended improvement and neighboring critical behavior, including regression checks from incident memory.

A successful HTTP status, screenshot or lack of errors is not enough. Verify meaningful persisted/downstream outcomes where authorized. If that requires unavailable access or unauthorized writes, report the exact gap; do not label the release verified.

## 4. Observe real use

Use the agreed immediate observation window and traffic/sample threshold. Propose defaults when absent: fifteen minutes plus a meaningful successful use, adjusted for latency and risk. Also choose a delayed check based on when evidence can exist: after a few hours of normal use, next working morning for an evening deploy, after the next scheduled job, or after several days for rare flows. Define baseline, scenario, signals, minimum relevant use, stop condition and owner.

Read [persistent observation](references/observation.md). Register the actual supported continuation and retain its ID; do not merely promise to watch. Prefer one follow-up, never more than three without an agreed reason. A quiet system with no relevant successful use is `observation incomplete`, not success. If no credible use can be expected, report unproven instead of creating recurring noise.

Follow-up compares the same signals/cohorts with baseline, classifies `verified`, `regression` or `unproven`, and closes/cancels the task's remaining scheduled checks after adequate proof or the agreed limit. Never close unrelated monitors. Notify on regression and at the final outcome; keep routine progress quiet.

## 5. Recover and learn

For a confirmed regression, promptly state impact and causal evidence. Revert/rollback when users are blocked and the separately agreed supported reversal is compatible with current data and other releases. Code rollback does not reverse a migration. Do not reset shared history or discard others' work.

A forward fix is allowed only within the agreed small, contained scope and time/attempt budget, with demonstrated cause and regression proof. Propose one attempt/ten minutes when appropriate, counting build and deploy time. Never extend the budget to avoid escalation. Changes to product behavior, data storage, auth, permissions or billing require explicit review of authority; merge approval alone is not blanket emergency authority.

Use Build for any recovery PR, retain independent acceptance/review and check gates, verify its deployed artifact, and rerun the failed scenario. If neither safe route fits the agreement, escalate while continuing authorized diagnosis. Restored service and delivered feature are different outcomes.

Suggest a new or amended incident entry with evidence, escaped checks and an executable regression obligation. Follow the registry's save policy; an incident is not a blame record or a new source of operational authority.

## 6. Finish or leave resumable work

Report PR/merge and deployed revision, scenario/incident evidence, baseline comparisons, meaningful traffic, observation window/follow-up ID and remaining steps. Distinguish `PR ready`, `merged`, `release pending`, `deployed`, `observation incomplete`, `delivery verified`, and `service restored; delivery unmet`.

Only mark delivery verified after the required behavior and observation evidence exist. Track issue completion within authorized scope and repository conventions. Do not delete branches/worktrees or dependencies as automatic cleanup. Preserve the task record for resumption, reconciling it with live state first.
