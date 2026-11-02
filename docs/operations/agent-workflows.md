# Shape, Build and Ship

The three entry points replace the former nine-skill delivery family. Blackbird repository definitions
under `.agents/skills/{shape,build,ship}` are the shared source across projects; personal discovery paths can link to
these same files rather than maintaining additional copies.

- **Shape:** agree the outcome, design decisions, scope and validation brief.
- **Build:** implement or fix, test user journeys, independently review correctness/security,
  address PR feedback and establish readiness. Testing-only and review-only modes report
  findings without repairs or publication unless separately authorized.
- **Ship:** perform an authorized release, verify the running version and customer flow,
  observe meaningful use, then recover or report a verified delivery outcome.

Internal handoffs retain the user's authority and exclusions. Building does not authorize
merging or production data writes. A small change can use an approved concise brief. Existing
specifications stay current without changing correct requirements to excuse defects.

## Personal installation

From this checkout, run:

```sh
python3 .agents/skills/build/scripts/install.py --retire-legacy
```

This links Shape, Build and Ship into `~/.agents/skills`, `~/.codex/skills` and
`~/.claude/skills`. It retires the nine old personal entry points into a timestamped backup
outside those discovery roots; original targets of symlinks are unchanged. The backup manifest
lists each prior entry and new target. It refuses to replace a conflicting real directory for
one of the three new names. Rerunning against the same source is a no-op.

Canonical local source: `~/Developer/t3code/.agents/skills/`. Keep this checkout available: links depend on it. To move the source, copy/checkout the
three skill folders together in the new location and run its installer. Other repository
checkouts can still have their own old local definitions; this installer does not rewrite
unrelated worktrees. Migrate those deliberately before relying on the shared workflow there.
Active conversations may retain previously loaded skill instructions; refresh the skill catalog
or start a new conversation to discover the new entry points.

Legacy Fixit investigation and its >95% autonomous remedy gate are retained in Build’s `references/bugs.md`; this is a mode, not a fourth skill. Legacy requests preserve scope: brainit/designit/specit → Shape; implit/fixit/testit/reviewit/
finishit → the corresponding Build mode; composeit → coordinated delivery. Archived old
instructions are recovery material, not additional active workflow stages.

## Private incident memory

Build's [incident reference](../../.agents/skills/build/references/incidents.md) defines lookup
and capture. The default private location on Jakub's machine is
`~/.agents/personal-memory/engineering-incidents/`, in the synced Obsidian vault. Another
installation can set `WORKFLOW_INCIDENTS_DIR`. No incident content or production exports belong
in this shared repository.

The registry contains an `Index.md`, `TEMPLATE.md` and `entries/*.md`. Copy the template into
entries, use a unique ID/filename, and describe the observed failure, trigger, evidence,
required invariant and concrete regression check. Search reads files live. `Database.md` provides a compact summary/context/trigger/check index;
refresh it after approved saves and check freshness before agent triage. No database server
or fourth skill is required. Incomplete manual entries are surfaced with warnings.

From the repository root:

```sh
python3 .agents/skills/build/scripts/incidents.py --project owner/repository
python3 .agents/skills/build/scripts/incidents.py --project owner/repository --query 'visibility history defaults' --full
```

Testing and review consult relevant incidents independently and record executed regression
checks or evidence-backed non-applicability. Fixed incidents remain regression cases.
Say **“Save this as an incident: <thread, report or issue>”** for capture-only work. The agent
reads the source, checks duplicates, saves the approved record and refreshes the index.
“Refresh the incident index” updates the cache after manual file edits.
Automatically noticed lessons are suggested for save/edit/skip before saving; an explicit user
request to save is sufficient approval. This default is separate from routine task-progress
memory. Suggestions run during active skill work, not through a new background monitor.

## Release evidence

Persisted-data behavior requires representative old/new compatibility evidence, explained
differences and applicable mixed-version/deploy-window checks. Synthetic happy paths alone
are insufficient. The specialized `prod-replay-backtest` remains explicit-only; Build can
request it or use an already authorized equivalent isolated replay, never bypass its access rules.

Record evidence against exact code revisions, then prove the deployed artifact and customer
behavior. Register usage-timed follow-up with a real supported continuation. No relevant traffic
means unproven, not passed. Missing access or a blocked required check remains visible.

These are agent-followed workflows, not newly installed CI enforcement. Saving an incident
does not implement or execute a regression test automatically.
