#!/usr/bin/env bash
set -euo pipefail

# Installs Shadow Laptop Agent to run silently in the background on macOS (launchd) or Linux (systemd --user)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_SCRIPT="${SCRIPT_DIR}/shadow-laptop-agent.mjs"
NODE_BIN="$(command -v node || true)"

if [[ -z "${NODE_BIN}" ]]; then
  echo "Error: Node.js is required on PATH."
  exit 1
fi

if [[ ! -f "${AGENT_SCRIPT}" ]]; then
  echo "Error: Could not find ${AGENT_SCRIPT}"
  exit 1
fi

mkdir -p "${HOME}/.shadow-agent"
OS_NAME="$(uname -s)"

if [[ "${OS_NAME}" == "Darwin" ]]; then
  PLIST_PATH="${HOME}/Library/LaunchAgents/com.shadow.laptop-agent.plist"
  mkdir -p "${HOME}/Library/LaunchAgents"
  cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.shadow.laptop-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${AGENT_SCRIPT}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.shadow-agent/agent.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.shadow-agent/agent.log</string>
</dict>
</plist>
EOF
  launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl load "${PLIST_PATH}"
  echo "Installed macOS LaunchAgent: ${PLIST_PATH}"
elif [[ "${OS_NAME}" == "Linux" ]]; then
  SERVICE_DIR="${HOME}/.config/systemd/user"
  SERVICE_FILE="${SERVICE_DIR}/shadow-laptop-agent.service"
  mkdir -p "${SERVICE_DIR}"
  cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Shadow Laptop Control Agent
After=network.target

[Service]
ExecStart=${NODE_BIN} ${AGENT_SCRIPT}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
    systemctl --user enable --now shadow-laptop-agent.service
    echo "Installed Linux user service: ${SERVICE_FILE}"
  else
    "${NODE_BIN}" "${AGENT_SCRIPT}" --daemon
  fi
else
  "${NODE_BIN}" "${AGENT_SCRIPT}" --daemon
fi

sleep 1
if [[ -f "${HOME}/.shadow-agent/token.txt" ]]; then
  echo ""
  echo "Shadow Pairing Token:"
  cat "${HOME}/.shadow-agent/token.txt"
  echo ""
fi
