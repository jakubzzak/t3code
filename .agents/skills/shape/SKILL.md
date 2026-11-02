---
name: shape
description: Explore a product idea or consequential design decision and agree a concise, testable change brief before implementation. Use for planning and brainstorming; questions about these skills do not start delivery.
---

# Shape

Turn the request into an agreed outcome, then hand it to Build without making the user operate the internal stages. Keep decisions with the user and routine investigation with the agent.

Read [the shared delivery contract](../build/references/contract.md). Shape is investigation and conversation, not permission to implement, publish, merge or change production data. A request to edit or explain these skills does not execute them.

## Ground and challenge

Read current instructions, relevant code/callers, existing decisions and earlier issues/PRs. Preserve the current checkout; use read-only Git inspection or an isolated checkout rather than changing the user's branch to investigate.

Consult [incident memory](../build/references/incidents.md) for the affected project, component and failure mechanisms. Known incidents are evidence to recheck, not universal product requirements. Include relevant lessons in the proposed acceptance criteria.

Ask only questions that change scope or behavior and cannot be answered from available evidence. Usually one to three at a time. Skip questions already resolved. Challenge the actual user problem, simplest sufficient solution, exclusions, failure/recovery behavior and adjacent workflows. For technical decisions trace ownership, callers, persistence, permissions, concurrency, compatibility, deployment dependencies and rollback limits. Reuse existing components; justify additional state or infrastructure with a demonstrated need.

For consequential architecture, obtain an independent critique when authorized delegation is available. The reviewer reads the relevant code and reports concerns; it does not edit or decide for the user. Check claims and report unresolved objections. Do not manufacture a council for a small change or claim independent review when unavailable.

Use an interactive visual when it clarifies a choice. Match the host's supported tools. A plain explanation is enough for a simple decision.

## Agree the brief

Keep the brief short and in the task's existing canonical home. A chat or issue brief is enough for a small change; substantial behavior should have a durable specification if the repository uses one. Do not create a spec branch or spec-kit scaffolding solely for ceremony.

Capture:

- Outcome, affected users and exclusions.
- Accepted decisions, important rejected alternatives and unresolved blockers.
- Observable acceptance scenarios, adjacent behaviors, relevant incident IDs and baseline evidence needed.
- Risk-based validation: product journeys and code review; real-data compatibility replay when persisted behavior is affected. A green synthetic test suite is not a substitute for representative data.
- Delivery authority: local-only, PR-ready, or merge and release; repositories/target environment; any separately authorized data operation.
- Release dependencies, deployed-version proof, immediate smoke check, traffic-based follow-up and supported recovery where release is in scope.

Preserve correct existing requirements; findings are not permission to change them. Follow [canonical record maintenance](../build/references/contract.md#canonical-record-and-continuity).

Once implementation is approved, continue with [Build](../build/SKILL.md), carrying the brief and authority. Approval to build normally includes scoped commits, feature-branch pushes and a PR unless narrowed; it never silently authorizes merge, deployment or production data writes. If the user requested planning only, stop with the brief.
