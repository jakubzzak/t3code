#!/bin/sh
# Keep-awake recovery protocol v1. Installed root-owned; never source the journal.
# Inspired by Joel Wohlhauser's Blackbird AwakeBackstop (MIT, T3 Tools Inc.).
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 077
ROOT=/var/db/com.blackbird.keep-awake-v1
HELPER=/Library/PrivilegedHelperTools/com.blackbird.keep-awake-v1
PMSET=/usr/bin/pmset

fail() { echo "$*" >&2; exit 1; }
[ "$(/usr/bin/id -u)" = 0 ] || fail "Keep awake requires its installed helper."
[ -d "$ROOT" ] && [ ! -L "$ROOT" ] || fail "Recovery directory is missing."
if [ "${1-}" != --locked ]; then
  exec /usr/bin/lockf -k -t 5 "$ROOT/lock" "$HELPER" --locked "$@"
fi
shift
command=${1-}
shift
journal="$ROOT/session"
now=$(/bin/date +%s)

number() { case "$1" in ''|*[!0-9]*) return 1;; esac; }
level() { case "$1" in 0|1|2|3|x) return 0;; *) return 1;; esac; }
token_valid() { [ "${#1}" = 32 ] && case "$1" in *[!a-f0-9]*) false;; *) true;; esac; }
read_state() {
  [ -f "$journal" ] || return 1
  IFS=' ' read -r token uid pid heartbeat sleep_before battery_before ac_before ups_before low_applied extra < "$journal"
  token_valid "$token" && number "$uid" && number "$pid" && number "$heartbeat" &&
    level "$battery_before" && level "$ac_before" && level "$ups_before" &&
    [ -z "$extra" ] || fail "Invalid recovery journal; retained for repair."
  case "$sleep_before:$low_applied" in 0:0|0:1|1:0|1:1) ;; *) fail "Invalid recovery journal.";; esac
}
write_state() {
  printf '%s %s %s %s %s %s %s %s %s\n' "$token" "$uid" "$pid" "$heartbeat" "$sleep_before" "$battery_before" "$ac_before" "$ups_before" "$low_applied" > "$ROOT/session.next"
  /bin/mv -f "$ROOT/session.next" "$journal"
}
read_power() {
  general=$("$PMSET" -g) || fail "Could not read sleep policy."
  sleep_current=$(printf '%s\n' "$general" | /usr/bin/awk '$1 == "SleepDisabled" {print $2}')
  # macOS omits SleepDisabled entirely when its default (0) is in effect.
  if [ -z "$sleep_current" ] && printf '%s\n' "$general" | /usr/bin/grep -q '^System-wide power settings:'; then
    sleep_current=0
  fi
  case "$sleep_current" in 0|1) ;; *) fail "This Mac does not expose the required sleep policy.";; esac
  custom=$("$PMSET" -g custom) || fail "Could not read power profiles."
}
profile() {
  value=$(printf '%s\n' "$custom" | /usr/bin/awk -v name="$1" '/^[^ \t]/ {section=$0} section == name && $1 == "lowpowermode" {print $2}')
  [ -n "$value" ] || value=x
  level "$value" || fail "Unknown Low Power Mode setting."
  printf '%s' "$value"
}
restore_profile() {
  previous=$1
  selector=$2
  name=$3
  [ "$previous" != x ] || return 0
  current=$(profile "$name")
  # Leave a subsequent external setting alone. Only undo a value we applied.
  if [ "$previous" != 1 ] && [ "$current" = 1 ]; then
    "$PMSET" "$selector" lowpowermode "$previous" || fail "Could not restore Low Power Mode; recovery remains installed."
  fi
}
restore_low() {
  [ "$low_applied" = 1 ] || return 0
  restore_profile "$battery_before" -b 'Battery Power:'
  restore_profile "$ac_before" -c 'AC Power:'
  restore_profile "$ups_before" -u 'UPS Power:'
}
restore() {
  read_power
  if [ "$sleep_before" = 0 ] && [ "$sleep_current" = 1 ]; then
    "$PMSET" -a disablesleep 0 || fail "Could not restore sleep; recovery remains installed."
  fi
  restore_low
  /bin/rm -f "$journal"
}
recover() {
  if read_state; then
    age=$((now - heartbeat))
    if [ "$age" -ge 45 ] || [ "$age" -lt 0 ] || ! kill -0 "$pid" 2>/dev/null; then
      restore
    fi
  fi
}
owner() {
  [ "$token" = "$requested_token" ] && [ "$uid" = "$SUDO_UID" ] || fail "Another Blackbird instance owns Keep awake."
}

case "$command" in
  recover)
    [ "$#" = 0 ] && [ -z "${SUDO_UID-}" ] || fail "Recovery is reserved for launchd."
    recover
    ;;
  status)
    [ "$#" = 0 ] || fail "Invalid status request."
    recover
    printf '{"version":1}\n'
    ;;
  apply)
    [ "$#" = 3 ] || fail "Invalid apply request."
    [ ! -f "$ROOT/disabled" ] || fail "Keep awake setup is being removed."
    requested_token=$1
    requested_pid=$2
    requested_low=$3
    token_valid "$requested_token" && number "$requested_pid" && number "${SUDO_UID-}" || fail "Invalid session."
    [ "$requested_pid" -gt 1 ] || fail "Invalid process."
    process_uid=$(/bin/ps -p "$requested_pid" -o uid= | /usr/bin/tr -d ' ')
    [ "$process_uid" = "$SUDO_UID" ] || fail "The session process belongs to another user."
    case "$requested_low" in 0|1) ;; *) fail "Invalid power request.";; esac
    recover
    read_power
    fresh=0
    if read_state; then
      owner
      [ "$pid" = "$requested_pid" ] || fail "Session process changed."
      [ "$sleep_current" = 1 ] || fail "Sleep policy changed outside Blackbird. Turn Keep awake off and on to retry."
    else
      fresh=1
      token=$requested_token uid=$SUDO_UID pid=$requested_pid
      sleep_before=$sleep_current
      battery_before=$(profile 'Battery Power:')
      ac_before=$(profile 'AC Power:')
      ups_before=$(profile 'UPS Power:')
      low_applied=0
    fi
    heartbeat=$now
    # The durable record must exist before any OS mutation, including a partial one.
    write_state
    if [ "$fresh" = 1 ] && [ "$sleep_before" = 0 ]; then
      "$PMSET" -a disablesleep 1 || fail "Could not prevent closed-lid sleep."
    fi
    if [ "$requested_low" = 1 ] && [ "$low_applied" = 0 ]; then
      [ "$battery_before:$ac_before:$ups_before" != x:x:x ] || fail "Low Power Mode is unavailable on this Mac."
      battery_before=$(profile 'Battery Power:')
      ac_before=$(profile 'AC Power:')
      ups_before=$(profile 'UPS Power:')
      low_applied=1
      write_state
      [ "$battery_before" = x ] || "$PMSET" -b lowpowermode 1
      [ "$ac_before" = x ] || "$PMSET" -c lowpowermode 1
      [ "$ups_before" = x ] || "$PMSET" -u lowpowermode 1
    elif [ "$requested_low" = 0 ] && [ "$low_applied" = 1 ]; then
      restore_low
      low_applied=0
      write_state
    fi
    read_power
    [ "$sleep_current" = 1 ] || fail "macOS did not retain the sleep setting."
    printf '{"version":1}\n'
    ;;
  release)
    [ "$#" = 1 ] && token_valid "$1" && number "${SUDO_UID-}" || fail "Invalid release request."
    requested_token=$1
    if read_state; then owner; restore; fi
    ;;
  uninstall)
    # Only the administrator dialog can invoke this; it is not in sudoers.
    [ "$#" = 0 ] && [ -z "${SUDO_UID-}" ] || fail "Removal requires administrator approval."
    recover
    [ ! -f "$journal" ] || fail "Keep awake is still owned by an app. Turn it off there first."
    : > "$ROOT/disabled"
    ;;
  *) fail "Unknown Keep awake operation.";;
esac
