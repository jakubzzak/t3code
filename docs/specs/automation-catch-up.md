# Catch up missed automations

## Problem and outcome

An enabled daily brief can be skipped because the laptop hosting its environment
was asleep or Blackbird was closed at the scheduled time. Users then have to run
it manually. Offer automatic catch-up when that environment resumes, without
requiring an always-on host or moving execution and context elsewhere.

## Scope

Add an optional catch-up policy for fixed-time automations, including daily and
weekly schedules. Expose it beside automation settings on web, desktop, and mobile
through the existing general settings and project override model.

Preserve existing interval scheduling and webhook delivery behavior. Exclude
remote execution, environment synchronization, per-automation overrides, an
age-limit setting, and automatic retries of failed agent work.

## Required behavior

- Add **Catch up missed automations**, off by default. General settings supply the
  environment default; projects inherit it unless explicitly overridden on or off.
  Clearing an override restores inheritance. Explain that it controls missed
  fixed-time runs and executes at most once per automation on return.
- Store and resolve the policy in the owning environment. A remote client edits
  that environment's policy; it does not become the execution host. Catch-up must
  not depend on opening a particular client, settings page, or chat.
- With catch-up enabled, an enabled automation whose fixed-time occurrence was
  missed while the server was unavailable becomes eligible when the server starts
  or resumes. Dispatch it automatically through the normal scheduler.
- Collapse missed occurrences into **one fresh run per automation**, even after
  weeks offline. There is no maximum age and no replay of every missed day or
  week. After dispatch, resume the normal schedule at its next future occurrence,
  retaining existing time-of-day, weekdays, and timezone rules.
- Use the current saved prompt, provider/model, and destination. A fresh run does
  not reconstruct historical briefs or guarantee coverage of every missed day;
  that remains the task prompt's responsibility. Existing-chat runs queue without
  interrupting an active agent; new-chat runs keep their workspace behavior.
- Intentionally paused automations do not accumulate catch-up work. Resuming one
  starts from the normal next occurrence. Deleted automations cannot catch up.
  Recheck eligibility before dispatch so pausing, deleting, or turning catch-up
  off before dispatch prevents the overdue catch-up run.
- With the effective policy off, retain existing fixed-time behavior, including
  the ten-minute lateness grace and skipping older missed occurrences. Turning
  the policy off does not cancel work already dispatched.
- A completed dispatch must not be duplicated by subsequent scheduler ticks,
  client reconnects, or server restarts. Preserve interrupted-dispatch recovery
  and failure reporting; do not automatically replay work that may already have
  started. Catch-up is for missed occurrences, not failed-run retry. Scheduler
  dispatch success must not imply that the agent completed its work.

## Acceptance criteria

1. With no setting saved, a fixed-time run missed by more than ten minutes stays
   skipped. General on enables catch-up in inheriting projects; project off
   overrides it. General off with project on enables catch-up in that project;
   clearing the override restores inheritance.
2. A 09:00 daily brief is enabled before sleep. With catch-up enabled, returning
   at noon dispatches one current brief automatically without opening its chat.
   Verify both sleep/wake and a stopped server starting later.
3. After two weeks with several missed occurrences, each eligible automation runs
   once, then has its normal next future occurrence. Further polls, reconnects,
   and restart after dispatch do not repeat it.
4. Pause before an absence, then resume: no catch-up is generated for the paused
   period. Pause or delete an overdue automation before dispatch, or disable its
   effective catch-up policy: the overdue run does not start.
5. Catch up a task bound to a busy chat and one that creates a new chat. The former
   queues without interrupting the agent; the latter uses its normal workspace.
   A dispatch failure remains visible without a new automatic retry loop.
6. Verify persistence, inheritance, and reset-to-inherit on web/desktop and mobile.
   A remote client sees and edits the same environment policy; disconnecting it
   does not prevent server catch-up. Interval and webhook behavior is unchanged.

## Constraints and decisions

Reuse the existing environment scheduler, durable task state, scoped settings,
and shared contracts. Do not add client-side timers, a per-missed-occurrence
backlog, or another execution service. Respect existing settings permissions,
provider availability, and scheduling recovery. Resolve the effective policy at
execution so changes from any supported client are authoritative.

The current [fixed-time lateness rule](../../apps/server/src/scheduledTasks/Schedule.ts)
and [dispatch/recovery path](../../apps/server/src/scheduledTasks/ScheduledTaskService.ts)
are the relevant constraints. Interval tasks take a separate overdue-run path;
the daily brief inspected during discussion is a fixed-time task.

## Assumptions and open questions

- Nonblocking assumption: enabling catch-up does not reconstruct occurrences
  already discarded while the policy was off. It applies to an occurrence still
  pending when the scheduler evaluates the effective setting.

No blocking product questions remain for implementation review.
