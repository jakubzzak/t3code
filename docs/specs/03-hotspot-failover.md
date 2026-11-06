# 03 — Proactive iPhone hotspot failover

**Status:** Implemented in draft PR; device acceptance and release verification pending.

User guide: [Reconnect through your iPhone](../user/background-service.md#reconnect-through-your-iphone).
Implementation branch: `feat/hotspot-failover`.
Pull request: [#71](https://github.com/jakubzzak/t3code/pull/71).

This is the behavior and acceptance contract for porting Joel Wohlhauser’s
app-managed hotspot feature into this fork. The user requested more proactive
reconnection after macOS leaves the Mac disconnected while actively working.
Implementation choices and unverified behavior are identified below; this spec
does not imply that physical-device testing or installation has happened.

## Problem and outcome

macOS automatic hotspot joining can leave a working session offline after Wi-Fi
drops. Blackbird should actively detect sustained loss of internet, wake and join
a nearby eligible iPhone hotspot, and try to return to saved Wi-Fi later.

Success means usable connectivity returns without manually opening the Wi-Fi
menu. Association with an access point alone does not prove internet recovery.
The user must be able to see failures and stop the automation. Network work must
not delay Keep awake’s battery and thermal safeguards.

## Scope and ownership

| Surface or condition                                  | Behavior                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| macOS desktop with Keep awake active                  | Eligible when Hotspot failover is enabled                              |
| Keep awake disabled, paused, or in error              | Stop hotspot work; retain the preference                               |
| Desktop connected to a remote environment             | Controls the local Mac only                                            |
| Standalone server, web client, mobile, Windows, Linux | No hotspot controller                                                  |
| Different projects, threads, or providers             | Share the desktop instance’s preference; opening a chat is unnecessary |
| Blackbird closed                                      | No autonomous hotspot service                                          |

The feature is opt-in and off by default. It is separate from macOS Auto-Join and
from the administrator setup used by Keep awake. Turning on failover does not
turn on Keep awake, install its privileged setup, or change system Auto-Join.

Exclude Android tethering, USB/Bluetooth tethering, a persistent system daemon,
remote-machine networking, per-project rules, a preferred-iPhone picker, cellular
usage accounting, and automatic captive-portal sign-in from this version.
Existing running agent requests are not replayed by this feature.

## User experience

Add **Hotspot failover** under **Settings → Keep awake**. Settings search must
find it using hotspot, iPhone, reconnect, and Wi-Fi terms on supported desktop
clients. Reuse the existing switch, settings persistence, and status presentation.

The description explains that it runs while Keep awake is active, uses mobile
data, needs both devices on the same Apple Account, and requires Location
Services for **Blackbird Hotspot** to identify Wi-Fi networks. Wi-Fi, Bluetooth,
and Personal Hotspot eligibility are prerequisites. Blackbird must not request
or store the iPhone hotspot password in the settings UI.

| Condition                               | Required feedback                                                         |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Preference off                          | macOS manages connections                                                 |
| Preference on but Keep awake inactive   | Waiting; preference saved                                                 |
| Eligible and prerequisites satisfied    | Watching the internet connection                                          |
| Native join underway                    | Connecting to the iPhone hotspot                                          |
| Association succeeds                    | Connected; subsequent probes still determine internet availability        |
| Permission denied or helper unavailable | Actionable error, retained until resolved; never falsely report readiness |
| Return to saved Wi-Fi fails             | Return-specific failure; explain later retry/manual recovery              |
| Older desktop lacks the capability      | Disabled control with an update explanation                               |

Status changes follow the existing awake-state publication cadence, currently
about ten seconds; the UI must not promise instantaneous feedback. Resetting
client settings restores failover to off. Disabling failover leaves Keep awake
and the current network connection intact.

## Connection policy

### Detect an outage and join

1. Start one sequential monitoring worker only after Keep awake is actually
   active and the preference is on. Repeated reconciliation must not create
   duplicate workers, scans, or joins.
2. Resolve the helper’s Location permission before attempting radio operations.
   Request it only when macOS reports it as undetermined. Denial must not cause
   repeated prompts. Retry the prerequisite check after thirty seconds so a
   permission granted in System Settings can recover without restarting the app.
3. Probe connectivity, then wait five seconds between completed monitoring
   iterations. Accept either the expected Apple connectivity response or the
   independent fallback response. A redirect, arbitrary HTTP 200 portal page,
   timeout, or rejected request is not success. Both probes must fail to classify
   the iteration as offline.
4. After the first offline observation, wait at least five seconds before a
   join attempt. Recheck connectivity after the pre-join scan; if the connection
   recovered, cancel the planned join and reset outage retry state.
5. Capture saved networks currently in range as the return baseline. A failed
   scan must not prevent the iPhone attempt. Record an unknown baseline rather
   than treating every saved network as newly available.
6. Use macOS Instant Hotspot discovery to wake an eligible nearby iPhone and
   associate with its advertised secured Wi-Fi network. The initial version
   selects the first eligible device returned by macOS; it offers no ranking or
   user-selected phone. Retry discovery scans briefly if broadcasting is delayed.
7. Keep attempts sequential. After failed attempts, use nominal delays of five,
   ten, twenty, then thirty seconds, capped at thirty until recovery. Reset the
   attempt count when internet is healthy. Continue probing after association;
   an iPhone with no working cellular internet must not be treated as recovered.

These delays are scheduling thresholds, not a promise to reconnect within five
seconds. Probe, permission, scan, discovery, and association durations add to
elapsed time. Each operation must have a timeout and cancellation path.

### Return to saved Wi-Fi

- Remember the hotspot established by this app instance: its SSID, the time of
  association, and the baseline saved networks. A hotspot joined manually before
  Blackbird starts is not automatically adopted as app-owned.
- While internet is healthy on that owned hotspot, check return eligibility at
  thirty-second intervals. Only saved, currently visible networks are candidates.
  Exclude the hotspot itself and candidates still in a failed-return cooldown.
- Prefer a saved network absent from the original baseline. Networks already
  nearby during the outage become eligible after ten minutes on the hotspot.
  If the baseline scan failed, hold all candidates for those ten minutes.
- Establish ownership using the Wi-Fi interface’s current SSID, not the default
  route: VPNs can replace the route and different iPhones share gateway addresses.
  Check ownership before and after scanning and immediately before native
  association. If the user selected a different network, abandon automatic return.
- Require a saved profile with matching network security. Do not delete saved
  profiles, toggle the Wi-Fi radio, or force a disconnect to provoke macOS joining.
- A failed return puts that candidate on a ten-minute cooldown. Other eligible
  candidates remain available at subsequent return checks. Keep retry timing
  bounded and show a return-specific error.
- Enterprise authentication and credentials macOS will not release without a
  prompt require manual connection. Do not display background Keychain dialogs
  or downgrade a saved protected network to an open network with the same name.
- A successful association ends that owned-hotspot stay. If the returned Wi-Fi
  still has no internet, the normal outage policy applies again. The ten-minute
  rule reduces immediate oscillation; it does not prove a candidate has internet
  before joining it.

### Stop, pause, resume, and quit

Turning either preference off, a battery/thermal pause, Keep awake error, setup
removal, or orderly app exit must cancel monitoring and outstanding helper work.
Stopping does not forcibly disconnect an already-established connection or turn
off the phone’s Personal Hotspot.

Within the same app instance, retain owned-hotspot and failed-return timing across
pause/resume so returning to Wi-Fi can continue. On resume, validate ownership
before changing networks. Do not persist or reconstruct ownership across app
restarts; an existing connection then remains under macOS control until a new
outage causes a new app-owned join. The user preference itself is persistent.

A helper surviving an abrupt app crash must have a finite deadline. An orderly
stop revokes its lease; an abrupt process death currently relies on the native
deadline rather than immediate lease cleanup. Do not claim instantaneous crash
cancellation or cancellation of an association already committed by macOS.

## Architecture, compatibility, and privacy

Use `DesktopAwake` for eligibility and state publication, a separately scoped
`DesktopHotspot` worker for orchestration, `HotspotPolicy` for retry/return rules,
and `HotspotSystem` for network probes and native process I/O. Slow network work
must not hold the power-reconciliation lock or block the ten-second safeguard
heartbeat.

Persist `awakeHotspotFailover` in existing client settings, defaulting to `false`
when absent. Retain explicit `true` and `false` through save/load and support
restore defaults. Add optional nullable `hotspotMessage` to the existing desktop
awake state: missing means an older bridge, null means supported without a
message. Older clients and ordinary web/server paths must remain compatible.

Bundle **Blackbird Hotspot.app** for Apple Silicon, Intel, and universal macOS
builds. All functional helper modes use the same LaunchServices app identity.
A scoped lease makes cancellation reach the app that LaunchServices launched,
not merely the `open` launcher. Check the lease before network mutations and
poll it while blocked. Native deadlines remain a fallback.

The launcher's exit status is not the helper's exit status. Validate each mode's
structured result; a return succeeds only when the helper confirms the requested
SSID. Empty, malformed, or mismatched results must retain owned-hotspot state,
show failure, and apply the candidate cooldown rather than claim a successful return.

Sign the helper with hardened runtime and its Location entitlement, including
when release signing replaces the development signature. Keep existing signing
options for other application components. Missing private Sharing.framework
classes/selectors or malformed helper results must fail safely with useful copy.
No minimum tested macOS/iOS version is asserted until device acceptance records
one; use of a private API is a compatibility constraint.

Hotspot passwords remain inside native memory: no renderer/IPC payloads, process
arguments, stdout/stderr logs, temporary files, or new stored password copy.
Saved Wi-Fi credentials may be used only inside that helper, without prompting.
Temporary helper results may contain SSIDs and must be removed when their scope
ends. Connectivity probes contact Apple and, on failure, Google; no chat,
project, or provider data belongs in those requests.

Implementation endpoints and limits are recorded here to make timing testable:

| Operation                         | Current policy                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Primary probe                     | `https://captive.apple.com/hotspot-detect.html`; successful response containing `<BODY>Success</BODY>` |
| Fallback probe                    | `https://www.gstatic.com/generate_204`; HTTP 204                                                       |
| Probe deadline                    | Four seconds per endpoint; redirects rejected; no cache                                                |
| Permission check                  | Native deadline 125 seconds; caller 130 seconds                                                        |
| Scan                              | Native deadline 20 seconds; caller 25 seconds                                                          |
| Status read                       | Caller deadline ten seconds                                                                            |
| Join / return                     | Native deadline sixty seconds; caller 65 seconds                                                       |
| iPhone discovery / broadcast wait | Up to 45 seconds discovery, then up to ten seconds scanning within the overall join deadline           |
| Lease check                       | Approximately every 100 milliseconds, plus checks before mutations                                     |

## Acceptance criteria

| ID  | Given / when                                                                           | Required outcome                                                                                                 |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A01 | No saved setting, explicit off, or older saved settings                                | Default off; no probes, prompts, scans, or joins                                                                 |
| A02 | Enable failover with Keep awake off, then activate Keep awake                          | Preference persists; waiting becomes active monitoring; no implicit privileged setup                             |
| A03 | Healthy internet; or one probe endpoint filtered                                       | No hotspot join; fallback success counts as online                                                               |
| A04 | Both probes fail repeatedly                                                            | Initial grace, sequential native attempt, bounded backoff; no duplicate worker                                   |
| A05 | Internet recovers during the pre-join scan                                             | No native join; retry state resets                                                                               |
| A06 | Baseline scan fails while offline                                                      | Still attempt iPhone; no return candidate bypasses the ten-minute hold                                           |
| A07 | Location denied, then granted externally                                               | Visible persistent error, no repeated prompt; retry recovers readiness                                           |
| A08 | Hotspot joined and new saved Wi-Fi appears                                             | Eligible at a return check; original failed Wi-Fi waits ten minutes                                              |
| A09 | First return candidate fails while another is available                                | First candidate waits ten minutes; other candidate can be tried                                                  |
| A10 | User switches networks before/during return scan, including another iPhone             | No return association; release ownership even if gateways match                                                  |
| A11 | VPN changes the default route while remaining on owned hotspot                         | Ownership and return checks still use the Wi-Fi interface                                                        |
| A12 | Disable, pause for low battery/heat, or orderly quit during pending native work        | Worker and helper cancel; safeguards continue; no forced disconnection                                           |
| A13 | Resume after a power pause while still on owned hotspot                                | Preserve original stay/cooldown timing and continue eligible return checks                                       |
| A14 | App restarts while already online on a hotspot                                         | Preserve preference but do not claim ownership or replace that connection                                        |
| A15 | Unsupported helper, malformed result, missing saved credentials, or enterprise profile | Actionable failure; no credential exposure or security downgrade                                                 |
| A16 | Saved setting true/false, reset defaults, old/new clients                              | Correct round-trip/default/reset behavior; older bridge control disabled                                         |
| A17 | arm64, x64, universal and signed release packaging                                     | Helper bundled, executable, correctly signed with Location entitlement                                           |
| A18 | Real nearby iPhone, Wi-Fi loss, later saved Wi-Fi recovery                             | Internet actually recovers through cellular, then through saved Wi-Fi; record elapsed time and selected networks |

Tests must distinguish policy simulation, renderer simulation, native code with
stand-in OS APIs, local build/signature checks, and real hardware behavior.
Passing one category cannot be reported as passing another.

## Verification and release gates

**Security finding S1 — accepted for the user's personal build only, 2026-11-03:**
the current helper accepts commands from any caller
running as the same macOS user with an existing lease file. Once the helper has
Location permission, another local app can invoke it to obtain network names or
request hotspot/network changes under that grant. Passwords are not returned.
The lease provides cancellation, not caller authentication. After disclosure,
the user explicitly chose “Accept this risk for my personal build.” This accepts
the residual risk in the implementation at `be1fd0b93c91b9bb5daec7f3a8554d997b1259ef`;
it does not fix it or authorize general distribution, installation, or network
testing. Expanded exposure needs a new disposition. An ordinary user-readable
nonce file does not establish a boundary against another process running as
that user.

At implementation revision `ae29b9d20ee8a5ff0dc938c295bf1a859d8bac37`, 398 focused
tests across twelve files pass, along with scoped desktop/web typechecks and the
desktop build. Coverage includes settings compatibility, retry/return policy,
power-loop independence, process argument/lease handling, native ownership guards,
three-architecture helper builds, and helper-specific signing configuration.
The actual settings page was exercised at 1280px and 800px with a simulated
desktop bridge; this is renderer evidence, not an installed-device test.

Second review found B1: `open -W` reports success even when the launched helper
fails, and the return adapter originally ignored its output. Three regression
cases (empty, malformed, and wrong-network output) reproduced the false success.
The adapter now requires a decoded matching SSID; all 29 focused adapter,
monitor, policy, and power-coordinator tests pass after the correction. The
previous 398-test result describes the earlier revision, not this follow-up.

After integrating main `c15d1dde4ac64cd9c29e601688309a0ac15ca6b1`, candidate
`c37e3e235db6370c24f8ea16fc58159dbe8769fa` passes 409 focused tests in thirteen
files and scoped desktop/web typechecks. Independent final code review reports
no new blocking findings and confirms B1 is fixed and S1's accepted exposure has
not expanded. Two sanitized actual-profile settings shapes preserve legacy
values and default the new preference to off; four explicit-value round-trips
pass. [Validation and UI evidence](https://github.com/jakubzzak/t3code/pull/71#issuecomment-6609986828)
distinguish simulated desktop interaction from remaining device acceptance.

A local macOS arm64 archive was built from that candidate with SHA-256
`632d33641a9b9ff7b2472c347f6678cceaa7525b4474a62ecefe2f97fbbf31c6`.
The helper extracted from the archive passes strict signature verification and
contains the Location entitlement and arm64 executable. This verifies local
packaging; the archive is not a Developer ID signed/notarized release and has
not been installed. Its extracted helper was used for the live test below.

### Live test follow-up, 2026-11-03

The user explicitly authorized the live test, including Location prompts and brief
Wi-Fi interruption. On macOS 26.6.2 (25G83), arm64, the extracted helper exposed a
startup race: authorization succeeded, but subsequent processes checked a fresh
Location manager before its initial authorization callback and reported denial.
The helper now waits up to two seconds for that initial state before checking or
requesting permission. Background modes still never request authorization. A
deferred-state fixture failed before this fix and passes afterward. If the initial
callback times out, the helper emits no result and exits with an error so the
controller retains hotspot ownership and retries. A separate failing regression
proved the timeout previously looked like a disconnected network. All 33 focused
native/adapter/monitor tests pass across three files, including delayed authorization
without a prompt and a successful return retry after a temporary status failure.

The rebuilt helper activated and joined the nearby iPhone in 15.22 seconds.
The Wi-Fi SSID matched the helper result and differed from the original, and an
HTTPS internet probe passed. This was a direct helper test through LaunchServices,
not the full controller-triggered outage journey; the iOS version was not collected.

**Automatic return failed on this Mac:** the no-prompt Keychain lookup could not
obtain the original saved network's credentials. The exact Keychain error was not
instrumented, so missing versus inaccessible credentials is not distinguished.
The helper left the working hotspot connected. macOS Wi-Fi controls then restored
the original network, verified by SSID and successful internet access. A separate
`networksetup` reconnect preflight also failed with `-3900` despite exit zero;
it briefly disconnected before macOS recovered and is not a working fallback.
No password export, Keychain access-control change, profile deletion, or radio
cycling was used.

A live scan cancellation experiment completed its result before cancellation could
be established, so it is inconclusive. Deterministic lease-cancellation tests still
pass. The older archive above does not include the permission-race correction.

The following remain release gates rather than completed acceptance:

- Cancellation of pending native work through LaunchServices; permission attribution
  passed for the local ad-hoc helper, not a Developer ID release.
- Full controller-triggered iPhone failover and recovery after
  unavailable phone/cellular service; direct helper association/internet passed. Record macOS, iOS, Mac architecture, and
  multiple-phone selection behavior.
- Real return to representative saved WPA2/WPA3 networks, including Keychain
  restrictions, a still-broken network, VPN use, and a manual network selection
  during a pending initial join. Do not infer those outcomes from mocked scans.
- Developer ID signed/notarized packaged artifact verification, including the
  nested helper’s final entitlements and the installed app’s actual version.
- Recheck changed code or exposure after the reviewed candidate. The prior
  code review covered the pre-live-test candidate; S1 remains accepted only for personal use. No other
  risk is accepted merely because the implementation compiles or this spec exists.

The user's explicit Build invocation authorized feature-branch publication and
draft PR preparation. The subsequent explicit approval authorized the live network
test described above. No merge, installation, or deployment has been performed.
Further live tests must stay within the approved scope because they can interrupt
the connection the user is using. To recover from an
unsuccessful test, disable failover and manually reconnect through macOS; there
is no destructive saved-network migration to reverse.

## Source and rationale

The starting behavior comes from Joel Wohlhauser’s Blackbird at
[`3f4fd46b676f8fb07906642934295c4920da9b37`](https://github.com/joelwohlhauser/blackbird/tree/3f4fd46b676f8fb07906642934295c4920da9b37).
This port retains the active-Keep-awake boundary and nominal retry/return timing.
It separates the network worker from power safeguards, keeps credentials native,
and uses guarded association instead of deleting network preferences or cycling
the Wi-Fi radio. Same-instance ownership retention, two connectivity probes,
per-network return cooldown, and LaunchServices cancellation are implementation
choices addressing the observed review failures.
