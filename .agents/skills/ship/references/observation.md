# Persistent observation

Choose one evidence-based follow-up time, baseline and minimum meaningful use before scheduling. Read the live scheduler tool schema; do not assume a one-time trigger exists on every host. Use a supported one-time trigger when available. If only recurrence is available, use it only when authorized and put disabling/deleting that exact task as the FIRST run action; verify it actually stopped. Otherwise report continuation unavailable and assign a concrete handoff. No silent recurring timers.

Retain the returned task ID, thread, cadence/next-run time and actual timezone offset. The prompt must carry task/PR identity, deployed artifact/time, scope/authority limits, baseline numbers and source, relevant incident IDs, exact read-only checks, meaningful-use threshold, stop condition and task IDs to cancel. No credentials/customer exports in prompts. Prevent duplicate registrations on resume by checking existing task state before creating another.

A scheduled wake is permission to perform the scoped observation, not permission to merge unrelated work or widen production writes. Reconcile the deployed version; later releases may change attribution. Report regressions with evidence and follow Ship's recovery limits. No traffic means unproven; do not add more checks merely because the first had no evidence. After success or the agreed final attempt, cancel only this delivery's remaining tasks and report the outcome.

Watching PR checks is separate from observing production. Register host PR watches for pending PR activity; use the supported scheduler/continuation for post-release evidence. Never hold an active session indefinitely or imply that prose alone creates monitoring.
