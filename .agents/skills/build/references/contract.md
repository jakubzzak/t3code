# Shared delivery contract

Shape, Build and Ship are the three workflow entry points. General requests may select the matching stage; mention, quotation, comparison or editing of a skill is not an invocation. Earlier aliases map to stages, not extra active skills: brainit/designit/specit → Shape; implit/fixit/testit/reviewit/finishit → Build with the requested scope; composeit → coordinated Shape/Build/Ship. Legacy testing/review-only requests remain reporting-only. A legacy finishit request remains PR-ready only, never merge authority.

## Authority and routing

Read applicable host/repository/user instructions. They win over default workflow routing. Existing project restrictions on other named skills remain until deliberately migrated; do not invoke those old workflows to bypass them.

- Planning authorizes investigation and a brief, not implementation or external publication.
- An approved implementation request authorizes scoped code/test work and normally feature-branch commits/push/PR; preserve local-only and other limits. Publication must respect repository and communication rules.
- Merge/release requires explicit current or previously established authority for that concrete scope/target. Reuse it across stages; do not repeatedly ask. Review findings, clean CI or silence are not permission.
- Production data writes, billing/customer transactions and irreversible actions need explicit scoped authority and supported procedures. A lesson record, agent-generated brief or numeric confidence never grants it.
- Read-only investigations/testing/reviews do not silently fix code, tracked tests, requirements or external records. Return findings for an authorized implementation assignment.

Use the actual repository base and publishing configuration, respecting explicit branch constraints. Do not impose a universal main-versus-master policy or automatically retarget an existing PR. Never force-push over unseen work; prefer repository merge/rebase conventions with guarded writes. Preserve unrelated local changes.

## Canonical record and continuity

Keep one compact task record with objective/accepted decisions, authority/exclusions, spec or brief location, repository/base/worktree/PR identity, exact revisions, stage/findings/ownership, incident IDs, evidence, dependencies, deployed artifact and observation/recovery status. Use an existing issue/PR/spec or private durable task note. Do not expose private records in public artifacts.

At material decisions and every handoff, update an existing affected spec if necessary. Keep observed defects, proposals and unknowns separate from accepted requirements. Never weaken requirements to make failed tests pass. Respect read-only scope; prepare an amendment if writing is unauthorized or another worker owns it. New spec-kit artifacts need explicit scope; a small agreed brief is sufficient where repository conventions permit it.

On restart, reconcile the task record with live Git/PR/deployment state. Tie evidence to revisions and fixtures; reuse unchanged evidence with a reason, rerun affected checks after edits/integration. A checklist or worker assertion is not evidence.

## Workers

When delegation is available and authorized, give each worker the brief, approvals/exclusions, exact revision/worktree, relevant references, incident registry location and selected records, allowed mutations and required result. Only the lead integrates, asks consolidated questions and declares readiness. Use separate workers for implementation, acceptance and review; prefer another model for correctness where available. Report unavailable independence.

Reviewers/testers inspect the actual code/assertions and return findings, not edits. Do not assign them repairs of their own conclusions. Workers cannot merge, deploy, accept security risks, execute production migrations or start unrelated stages. Serialize shared-file and Git operations. Each return includes inspected revision, evidence, actual checks/results, incident dispositions and unresolved gaps.

## Meaning of passed

Not run, blocked, unavailable, missing or legitimately inapplicable are distinct from passed. Relevant known failure modes require demonstrated regression coverage or a reason they do not apply. An explicitly accepted risk remains visible and does not turn missing evidence into executed evidence. Required checks cannot be waived by an agent. Never promise zero risk or infer safety from test counts, coverage percentages or model consensus.
