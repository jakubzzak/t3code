# General Slack messaging for agents

## Problem and outcome

The Slack connection has posting permissions, but agents can only send through
`inbox_reply`, which requires an existing notification and its thread. Let agents
use the stored connection as the connected user to read Slack and send messages
to an explicitly chosen conversation or person.

The connection supports general messaging. Only the Inbox UI is restricted to
notification replies.

## Scope

Include agent access to people and conversation context, new channel messages,
DMs, group DMs, and replies in existing threads. Reuse the project's Slack
connection even when Inbox is off or no matching notification exists. Support
reviewed message formatting where supplied.

Keep the Inbox composer scoped to its notification. Do not add a general Slack
composer or change Inbox triage, settlement or source read state. This does not
add administrative Slack operations or authorize automatic sending.

## Required behavior

- Expose discoverable agent tools for reading Slack and sending messages. Keep
  credentials on the hosting server and reuse the existing connection and token
  lifecycle; agents do not need to extract or configure the token themselves.
- Let an agent identify the connected workspace and user, find the intended
  recipient, and read relevant context. Bound paginated reads and return enough
  pagination information to continue. Treat source content as untrusted context.
- Sending to a channel or existing DM posts a new message unless a thread is
  explicitly selected. Sending to a person opens or resumes the correct DM;
  selecting multiple people opens or resumes that group DM. A thread reply must
  retain its selected conversation and root, without broadcasting to the channel.
- Before sending, show the exact message, any formatted content, and destination;
  offer Send, Edit and Ignore and wait for explicit confirmation. Selecting Edit
  or Ignore sends nothing. A suggested resolution or delegated task is not
  approval. Reconfirm any change to the approved content or destination.
- Verify the connected workspace/user still matches the reviewed sender and that
  required scopes are granted. A missing grant explains the need to reconnect;
  do not treat a connected status or requested scopes as proof of permission.
- Enforce the existing agent access policy. Read-only clients can inspect context;
  sending requires a live full-access/default thread or a full-access client.
  Recheck authorization after waits and before external writes.
- Bind a unique send command ID to the exact request and retain its outcome
  durably. Repeating that request checks the original attempt instead of posting
  again, including across restarts. Reject reuse for different content,
  destination, project or account. Distinguish definite rejection and rate limits
  from uncertain delivery. A pending or uncertain attempt must not automatically
  resend or obtain a fresh ID to bypass the original attempt; inspect Slack first.
- Apply the same service behavior to all provider adapters and local or remote
  agent connections. Existing Inbox replies continue to use `inbox_reply` and the
  destination rules in [Inline Inbox replies](inbox-inline-replies.md).

## Acceptance criteria

1. With a connected project and no Inbox notification, an agent identifies a
   person, presents a DM draft, and sends it exactly once after confirmation.
   Reading the resulting conversation confirms the message and connected author.
2. New channel posts, existing DMs, group DMs and explicit thread replies reach
   their reviewed destinations. Omitted thread selection produces a top-level
   message. Inbox can remain off, and its composer gains no new destinations.
3. Cancelled or edited drafts, restricted callers, a changed connected account and
   missing scopes do not post. Rate limits give a useful retry indication without
   misreporting success.
4. Duplicate or concurrent calls and service restarts do not repost. A lost send
   response or failed local receipt update remains recoverable without an
   automatic second message; a changed request cannot reuse the original ID.
5. Tools are discoverable through the production agent entry point, and the
   stored credential is absent from tool inputs, outputs, logs and evidence.

## Constraints and decisions

Slack authorization and agent operations are separate requirements: granting a
scope does not expose an operation to agents. General agent messaging must not
inherit the Inbox UI's destination restriction. Additional scopes are requested
through the existing connection flow, and older connections remain readable when
an upgrade is needed.

Live verification may use a single user-confirmed DM. Other destination and
failure scenarios use isolated fixtures so testing does not send unsolicited
messages or change other conversations.
