#!/bin/bash
#
# Engine watchdog: the only code that signals engine processes.
#
# The app starts one watchdog per engine run and holds the write end of its stdin. When the app
# exits or dies for any reason, the kernel closes that pipe, `read` returns EOF, and this script
# stops the engine in order. A normal quit and a crash take the same path.
#
# Commands arrive one per line:
#   RUN <uuid>                     names the run used in process tags
#   ADD <slot> <generation> <pid>  records the process and its start time; replaces the slot,
#                                  except leftover, which appends
#   DEL <slot>                     forgets a slot after a normal exit
#   STOP <slot>...                 stops those slots, then kills whatever carries their tags
#
# A PID is signaled only while it still has the start time recorded at ADD. A different start
# time means the process is gone and the PID may now belong to something else.
#
# Written for the bash 3.2 that ships with macOS. There is no `set -e` or `set -u`, because a
# failed command or an empty variable must not end this script while the engine is running.

trap '' TERM INT HUP PIPE

RUNTIME_HOME="${IMMORADAR_WATCHDOG_RUNTIME_HOME%/}"
if [[ -z "$RUNTIME_HOME" ]]; then
  echo "IMMORADAR_WATCHDOG_RUNTIME_HOME is required" >&2
  exit 64
fi

# Grace periods are counted in polls, not wall-clock time, so a Mac that sleeps mid-stop does not
# wake up and escalate at once. Tests shorten the poll to keep the ladder fast.
POLL_SECONDS="${IMMORADAR_WATCHDOG_POLL_SECONDS:-0.2}"
POLLS_PER_SECOND=5

HOME_MARKER="IMMORADAR_ENGINE_HOME=$RUNTIME_HOME/"
RUN_ID=""

ENTRY_COUNT=0
ENTRY_SLOT=()
ENTRY_GENERATION=()
ENTRY_PID=()
ENTRY_STARTED=()

log() {
  printf '%s watchdog: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# Prints "<start time> <state>" normalized to single spaces, or nothing when the PID is gone.
process_line() {
  local fields
  fields="$(LC_ALL=C ps -o lstart= -o stat= -p "$1" 2>/dev/null)"
  [[ -n "$fields" ]] || return 1
  # Unquoted on purpose: word splitting collapses the padding ps adds to its columns.
  # shellcheck disable=SC2086
  echo $fields
}

# Sets STARTED to the start time of a live, non-zombie PID. Fails otherwise.
read_started() {
  local line state
  line="$(process_line "$1")" || return 1
  state="${line##* }"
  case "$state" in Z*) return 1 ;; esac
  STARTED="${line% *}"
}

is_same_process() {
  read_started "$1" && [[ "$STARTED" == "$2" ]]
}

find_entry_targets() {
  TARGETS=()
  local index slot
  for ((index = 0; index < ENTRY_COUNT; index++)); do
    slot="${ENTRY_SLOT[index]}"
    [[ -n "$slot" ]] || continue
    case " $1 " in
      *" $slot "*)
        if is_same_process "${ENTRY_PID[index]}" "${ENTRY_STARTED[index]}"; then
          TARGETS+=("$index")
        fi
        ;;
    esac
  done
}

signal_targets() {
  local index
  for index in "${TARGETS[@]}"; do
    if is_same_process "${ENTRY_PID[index]}" "${ENTRY_STARTED[index]}"; then
      log "${ENTRY_SLOT[index]} pid=${ENTRY_PID[index]} SIG$1"
      kill "-$1" "${ENTRY_PID[index]}" 2>/dev/null
    fi
  done
}

any_target_alive() {
  local index
  for index in "${TARGETS[@]}"; do
    is_same_process "${ENTRY_PID[index]}" "${ENTRY_STARTED[index]}" && return 0
  done
  return 1
}

# Returns 0 as soon as every target is gone, 1 when the grace period runs out first.
wait_for_targets() {
  local remaining=$(($1 * POLLS_PER_SECOND))
  while ((remaining > 0)); do
    any_target_alive || return 0
    sleep "$POLL_SECONDS"
    remaining=$((remaining - 1))
  done
  ! any_target_alive
}

# run_rung "<requested slots>" "<rung slots>" <signal> <seconds> [<signal> <seconds>]...
# Every rung ends in SIGKILL. Targets within a rung stop in parallel.
run_rung() {
  local requested="$1" rung_slots="$2" wanted="" slot
  shift 2
  for slot in $rung_slots; do
    case " $requested " in *" $slot "*) wanted="$wanted $slot" ;; esac
  done
  [[ -n "$wanted" ]] || return 0

  find_entry_targets "$wanted"
  [[ ${#TARGETS[@]} -gt 0 ]] || return 0

  while (($# >= 2)); do
    signal_targets "$1"
    wait_for_targets "$2" && return 0
    shift 2
  done
  signal_targets KILL
  wait_for_targets 1
}

# Kills every process whose environment holds one of the given NAME=value strings. This catches
# what no ADD covers: Chromium and its helpers, and a Node child spawned just before the app died.
# macOS hides the environment of Apple's own binaries from ps, and Postgres and Redis overwrite
# theirs when they set a process title, so those are stopped through their slots instead.
#
# The listing is captured first and matched here, so there is no filter process that could match
# itself. Splitting the capture avoids `read`, which takes one syscall per byte on a pipe. ps
# escapes newlines in arguments, so each line is one process.
sweep_markers() {
  local IFS=$'\n'
  local lines line marker pid
  set -f
  # shellcheck disable=SC2207
  lines=($(ps -axEww -o pid=,command= 2>/dev/null))
  set +f
  for line in "${lines[@]}"; do
    for marker in "$@"; do
      case "$line" in
        *" $marker "* | *" $marker")
          if [[ $line =~ ^[[:space:]]*([0-9]+)[[:space:]] ]]; then
            pid="${BASH_REMATCH[1]}"
            if [[ "$pid" != "$$" ]]; then
              log "sweep pid=$pid SIGKILL"
              kill -KILL "$pid" 2>/dev/null
            fi
          fi
          break
          ;;
      esac
    done
  done
}

forget_slot() {
  local index
  for ((index = 0; index < ENTRY_COUNT; index++)); do
    [[ "${ENTRY_SLOT[index]}" == "$1" ]] && ENTRY_SLOT[index]=""
  done
}

add_entry() {
  ENTRY_SLOT[ENTRY_COUNT]="$1"
  ENTRY_GENERATION[ENTRY_COUNT]="$2"
  ENTRY_PID[ENTRY_COUNT]="$3"
  ENTRY_STARTED[ENTRY_COUNT]="$4"
  ENTRY_COUNT=$((ENTRY_COUNT + 1))
}

# Stops the requested slots in ladder order, whatever order they were named in.
stop_slots() {
  local requested="$*" slot index tags=()

  run_rung "$requested" "oneshot leftover" TERM 3
  run_rung "$requested" "worker-processing worker-scraper" TERM 10
  run_rung "$requested" "api" TERM 5
  run_rung "$requested" "redis" TERM 5
  run_rung "$requested" "postgres" INT 10 QUIT 3

  if [[ -n "$RUN_ID" ]]; then
    for slot in $requested; do
      for ((index = 0; index < ENTRY_COUNT; index++)); do
        if [[ "${ENTRY_SLOT[index]}" == "$slot" && "$slot" != "leftover" ]]; then
          tags+=("IMMORADAR_ENGINE_TAG=$RUN_ID.$slot.${ENTRY_GENERATION[index]}.")
        fi
      done
    done
    [[ ${#tags[@]} -eq 0 ]] || sweep_markers "${tags[@]}"
  fi

  for slot in $requested; do
    forget_slot "$slot"
  done
}

is_known_slot() {
  case "$1" in
    oneshot | leftover | worker-processing | worker-scraper | api | redis | postgres) return 0 ;;
    *) return 1 ;;
  esac
}

is_number() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

handle_add() {
  local slot="$1" generation="$2" pid="$3"
  if ! is_known_slot "$slot" || ! is_number "$generation" || ! is_number "$pid"; then
    log "ignored ADD $slot $generation $pid"
    return
  fi
  if ((pid <= 1)) || [[ "$pid" == "$$" ]]; then
    log "ignored ADD $slot $generation $pid"
    return
  fi
  [[ "$slot" == "leftover" ]] || forget_slot "$slot"
  if read_started "$pid"; then
    add_entry "$slot" "$generation" "$pid" "$STARTED"
    log "added $slot generation=$generation pid=$pid"
  else
    log "$slot pid=$pid exited before ADD"
  fi
}

handle_stop() {
  local slot known=()
  for slot in "$@"; do
    if is_known_slot "$slot"; then
      known+=("$slot")
    else
      log "ignored STOP $slot"
    fi
  done
  [[ ${#known[@]} -eq 0 ]] || stop_slots "${known[@]}"
}

handle_command() {
  local verb="$1"
  shift
  case "$verb" in
    RUN)
      case "$1" in
        '' | *[!A-Za-z0-9-]*) log "ignored RUN $1" ;;
        *)
          RUN_ID="$1"
          log "run $RUN_ID"
          ;;
      esac
      ;;
    ADD) handle_add "$1" "$2" "$3" ;;
    DEL)
      if is_known_slot "$1"; then
        forget_slot "$1"
        log "forgot $1"
      else
        log "ignored DEL $1"
      fi
      ;;
    STOP) handle_stop "$@" ;;
    *) log "ignored command $verb" ;;
  esac
}

log "started pid=$$"

# `read` leaves a line with no newline unprocessed, so a command cut off by the app's death can't
# be acted on with half a PID.
while IFS= read -r command_line; do
  set -f
  # shellcheck disable=SC2086
  handle_command $command_line
  set +f
done

log "pipe closed, stopping the engine"
stop_slots oneshot leftover worker-processing worker-scraper api redis postgres
sweep_markers "$HOME_MARKER"
for ((poll = 0; poll < POLLS_PER_SECOND; poll++)); do
  sleep "$POLL_SECONDS"
done
sweep_markers "$HOME_MARKER"
rm -f "$RUNTIME_HOME/engine-run.json"
log "stopped"
exit 0
