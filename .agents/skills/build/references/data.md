# Data compatibility and migrations

Read when changing persisted meaning, historical workflow state, visibility/publication, completion actions, defaults, schema, derived views or data repair. This applies even when no migration script is added.

## Compatibility evidence before release

Identify source-of-truth, derived/projection and audit/history data. Unknown ownership or meaning is a blocker. Preserve audit history; do not rewrite it merely because a newer field has the same name. Explicit corrections need separately agreed semantics. Rebuild derived data through the supported path. Never guess missing values from convenient adjacent fields.

Inspect representative real data shapes through permitted read-only access or a user-supplied export. Classify old/new/both/neither, explicit false/null/missing/empty, active/completed/paused cases, ambiguous/reused names and multiple historical references where relevant. Choose cohorts from actual domain states, not guessed labels. Record selection, counts, exclusions and sample limits; no claim of population coverage from a handful of fixtures.

Replay the SAME safely isolated records through the old and candidate computation and actual changed mappers/API boundaries. Verify baseline fidelity against known deployed output. Compare business invariants, not JSON equality alone: visible records, completion state, required actions, ordering and retained history. Explain every difference as intended, regression, wrong in both, baseline issue or harness issue; unexplained important differences block readiness. For affected UIs, verify representative rendered outcomes and full critical journeys. Test new code with old persisted data and supported mixed client/server/deploy-window combinations.

For Jurata, the existing prod-replay-backtest skill contains a specialized harness and stricter export rules. It remains explicit-only: request that invocation when needed, or use an already authorized equivalent isolated replay with demonstrated coverage. Do not invoke it implicitly, connect to production against its rules, or make its mere presence count as evidence. If necessary data/access is missing, record the compatibility gate as blocked; ask for the minimum permitted export. No production writes, emails, webhooks or customer actions from replay.

Persist a small sanitized reproducer and meaningful regression assertions in the existing test suite when possible. Private production exports stay outside repositories/public artifacts, subject to the source's retention policy. Incident memory links to evidence; it must not contain raw customer records or credentials.

## Preparing a script

Read the repository's database/migration instructions and actual execution-surface constraints first. For Jurata, read docs/mongodb-scripts.md. Defaults are read-only dry-run and explicit target validation; never silently choose production or embed credentials. Distinguish actual target-shell validation from syntax checks or mocks.

Use narrow intended updates, preserve unrelated fields and explicit empty/reset values, preflight conflicts and guard writes against changed assumptions. Reruns must be safe. Define transaction/atomicity boundaries; report partial completion, concurrency conflicts and readback failures. Never silently downgrade transactional requirements. Test the exact artifact with isolated fixtures/disposable storage for dry-run zero writes, intended apply, no-op rerun, conflicts and partial failures. Provide complete compatible paste/run instructions and post-run invariants.

Establish code/data order, backup/restore availability, rehearsal and rollback limits before release. Prefer compatible staged transitions; blindly running all scripts after deployment can leave a broken interval. Pin script revision/hash, database, selection/cutoff, expected counts and owner. Preparing or naming it is not execution authority. Existing manual-only rules remain binding.

Before any real apply, reconcile whether an earlier version already ran, its exact scope/results and concurrent changes. A dry-run report is not proof of an apply; later evidence can supersede earlier status. If applied, do not casually revise and rerun as if production were untouched. Use a separately reviewed corrective plan when needed. Verify persisted state after execution; process success alone is insufficient.
