#!/usr/bin/env bash
# setup.sh — install and run trunk-recorder-dashboard
#
# A small Node.js web server that subscribes to events from the trunk-recorder
# MQTT status plugin (https://github.com/TrunkRecorder/tr-plugin-mqtt) and
# renders a live status UI in the browser.
#
# Usage:
#   ./setup.sh                          # interactive prompts, then start
#   ./setup.sh --no-prompt              # use defaults / env vars, then start
#   ./setup.sh --no-start               # install only
#   ./setup.sh --help
#
# All settings can also be supplied via environment variables:
#   MQTT_URL  MQTT_USERNAME  MQTT_PASSWORD
#   MQTT_TOPIC  MQTT_UNIT_TOPIC  MQTT_MESSAGE_TOPIC
#   MQTT_AUDIO_ENABLED  RECORDINGS_DIR  AUDIO_RETENTION
#   PORT
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

# --- Defaults (override via env or prompts) -----------------------------------
MQTT_URL="${MQTT_URL:-mqtt://localhost:1883}"
MQTT_USERNAME="${MQTT_USERNAME:-}"
MQTT_PASSWORD="${MQTT_PASSWORD:-}"
MQTT_TOPIC="${MQTT_TOPIC:-trunk-recorder}"
MQTT_UNIT_TOPIC="${MQTT_UNIT_TOPIC:-trunk-recorder/units}"
MQTT_MESSAGE_TOPIC="${MQTT_MESSAGE_TOPIC:-trunk-recorder/messages}"
MQTT_AUDIO_ENABLED="${MQTT_AUDIO_ENABLED:-false}"
RECORDINGS_DIR="${RECORDINGS_DIR:-./recordings}"
AUDIO_RETENTION="${AUDIO_RETENTION:-100}"
PORT="${PORT:-3080}"

PROMPT=1
RUN_AFTER_SETUP="${RUN_AFTER_SETUP:-1}"

# --- CLI ----------------------------------------------------------------------
usage() {
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-prompt|-y)  PROMPT=0 ;;
    --no-start)      RUN_AFTER_SETUP=0 ;;
    --start)         RUN_AFTER_SETUP=1 ;;
    -h|--help)       usage ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

c_blue()  { printf "\033[1;34m%s\033[0m\n" "$*"; }
c_green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
c_red()   { printf "\033[1;31m%s\033[0m\n" "$*" >&2; }
c_dim()   { printf "\033[2m%s\033[0m\n" "$*"; }

ask() {
  local prompt="$1" var="$2" silent="${3:-}"
  local current="${!var}" answer
  [[ "$PROMPT" -eq 0 ]] && return
  if [[ "$silent" == "silent" ]]; then
    read -rsp "$prompt [hidden]: " answer; echo
  else
    read -rp "$prompt [${current}]: " answer
  fi
  [[ -n "$answer" ]] && printf -v "$var" '%s' "$answer"
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    c_red "Missing required command: $1"
    [[ -n "${2:-}" ]] && c_red "Install hint: $2"
    exit 1
  fi
}

# --- Prereqs ------------------------------------------------------------------
c_blue "==> Checking prerequisites"
require node "https://nodejs.org/  (or 'brew install node' / 'apt install nodejs npm')"
require npm  "ships with Node.js"

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if (( NODE_MAJOR < 18 )); then
  c_red "Node.js 18+ required (found $(node -v))."
  exit 1
fi
c_green "Node $(node -v) OK"

if [[ ! -f server.js ]]; then
  c_red "server.js not found in $PROJECT_DIR — are you running this from inside the repo checkout?"
  exit 1
fi

# --- Interactive config -------------------------------------------------------
if [[ "$PROMPT" -eq 1 ]]; then
  c_blue "==> Configure (press Enter to accept defaults)"
  c_dim  "    These should match the 'mqtt_status' plugin block in your trunk-recorder config.json"
  ask "MQTT broker URL"           MQTT_URL
  ask "MQTT username (optional)"  MQTT_USERNAME
  if [[ -n "$MQTT_USERNAME" ]]; then
    ask "MQTT password (optional)" MQTT_PASSWORD silent
  fi
  ask "MQTT status topic"          MQTT_TOPIC
  ask "MQTT unit topic"            MQTT_UNIT_TOPIC
  ask "MQTT message topic"         MQTT_MESSAGE_TOPIC
  ask "Enable audio playback (true/false)" MQTT_AUDIO_ENABLED
  if [[ "$MQTT_AUDIO_ENABLED" == "true" ]]; then
    ask "Recordings directory"     RECORDINGS_DIR
    ask "Audio retention (count)"  AUDIO_RETENTION
  fi
  ask "HTTP port"                  PORT
fi

# --- Install ------------------------------------------------------------------
c_blue "==> Installing dependencies"
npm install --silent

# --- Generate config files ----------------------------------------------------
c_blue "==> Writing .env"
umask 077
cat > .env <<EOF
PORT=$PORT
MQTT_URL=$MQTT_URL
MQTT_USERNAME=$MQTT_USERNAME
MQTT_PASSWORD=$MQTT_PASSWORD
MQTT_TOPIC=$MQTT_TOPIC
MQTT_UNIT_TOPIC=$MQTT_UNIT_TOPIC
MQTT_MESSAGE_TOPIC=$MQTT_MESSAGE_TOPIC
MQTT_AUDIO_ENABLED=$MQTT_AUDIO_ENABLED
RECORDINGS_DIR=$RECORDINGS_DIR
AUDIO_RETENTION=$AUDIO_RETENTION
EOF
umask 022

if [[ "$MQTT_AUDIO_ENABLED" == "true" ]]; then
  mkdir -p "$RECORDINGS_DIR"
fi

c_green "==> Setup complete"
echo
echo "  Config saved to: $PROJECT_DIR/.env"
echo "  Start manually:  ./run.sh"
echo "  Health check:    curl http://localhost:$PORT/healthz"
echo

if [[ "$RUN_AFTER_SETUP" == "1" ]]; then
  c_blue "==> Starting dashboard (Ctrl-C to stop)"
  echo "    Open http://localhost:$PORT"
  echo
  exec ./run.sh
fi
