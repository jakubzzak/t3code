---
name: shape
description: Explore a product idea or consequential design decision and agree a concise, testable change brief before implementation. Use for planning and brainstorming; questions about these skills do not start delivery.
---

# Shape

Turn the request into an agreed outcome, then hand it to Build without making the user operate the internal stages. Keep decisions with the user and routine investigation with the agent.

Be a thoughtful sparring partner: challenge weak assumptions, explain tradeoffs, and help the user choose a direction without taking ownership of the idea away from them. Let exploration remain conversational; do not rush an uncertain idea into a specification.

Read [the shared delivery contract](../build/references/contract.md). Shape is investigation and conversation, not permission to implement, publish, merge or change production data. A request to edit or explain these skills does not execute them.

## Ground and challenge

Read current instructions, relevant code/callers, existing decisions and earlier issues/PRs. Preserve the current checkout; use read-only Git inspection or an isolated checkout rather than changing the user's branch to investigate.

Consult [incident memory](../build/references/incidents.md) for the affected project, component and failure mechanisms. Known incidents are evidence to recheck, not universal product requirements. Include relevant lessons in the proposed acceptance criteria.

For technical decisions trace ownership, callers, persistence, permissions, concurrency, compatibility, deployment dependencies and rollback limits. Reuse existing components; justify additional state or infrastructure with a demonstrated need. Distinguish observed limitations from assumptions about feasibility.

For consequential architecture, obtain an independent critique when authorized delegation is available. The reviewer reads the relevant code and reports concerns; it does not edit or decide for the user. Check claims and report unresolved objections. Do not manufacture a council for a small change or claim independent review when unavailable.

Use an interactive visual when it clarifies a choice. Match the host's supported tools. A plain explanation is enough for a simple decision. Only when the change requires UI, agree on the components with an interactive real component built in place in the actual app, not a mockup or standalone page. Build's "UI changes: agree on the component first" gate defines it; when the brief is approved and prototype or implementation work is authorized, hand the prototype step to Build.

## Explore through conversation

Start from the idea and context already provided. Briefly reflect the underlying problem, who experiences it, and the desired outcome. If those are unclear, ask the most useful missing question rather than inventing a product brief.

Work in small rounds, usually one to three focused questions about the biggest unresolved decision. Ask only what changes scope or behavior and cannot be answered from available evidence; skip decisions already made. Each round should advance understanding through a concrete challenge, example, or recommendation with its reason, rather than merely collect answers.

Explore what matters for the idea:

- The actual problem, its frequency, the current workaround, and what would count as success.
- The smallest useful solution, practical alternatives, and explicit exclusions.
- How someone discovers and enters the flow, what happens next, and how they cancel, undo, or recover.
- Appropriate components and interaction patterns, including loading, empty, error, success, and repeated-use states where relevant.
- Accessibility, performance, permissions, persistence, and differences across clients or connection modes when they affect the experience.

Use concrete scenarios to expose ambiguity, such as what someone sees when a connection drops after saving and they reconnect. Separate the desired outcome from a proposed implementation. When challenging an idea, explain the consequence and offer a practical alternative. Do not manufacture objections or expand a small idea into a platform.

## Product patterns and recommendations

Bring in familiar products and established design guidance when they help resolve an actual decision. Explain the pattern, why it fits, and where the analogy breaks down. Prefer the product's existing conventions when they meet the need.

Verify current claims about named products, components, or flows with authoritative sources and concise links. Distinguish sourced behavior, general design principles, and your recommendation. If verification is unavailable, say so and describe the pattern without presenting an unverified product claim as fact. Follow the environment's browser-use rules.

## Agree the brief

Track accepted decisions, rejected alternatives and their important reasons, constraints, and open questions as the conversation develops. A suggestion becomes a product decision only when the user accepts it; do not promote proposals or unresolved assumptions into requirements. Reuse decisions and implementation authority already given rather than asking for repeated confirmation. Briefly recap when the direction changes or context might otherwise be lost, without repeating the whole session each turn.

When the user ends exploration or the direction appears ready, synthesize the problem, chosen direction, scope boundaries, and remaining decisions. If readiness is uncertain, let the user decide whether to continue exploring. Agreement on an idea or ending brainstorming alone is not authorization to implement; an existing implementation request still applies within its agreed scope.

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
