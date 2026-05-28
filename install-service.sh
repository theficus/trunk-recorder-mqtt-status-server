#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="trunk-recorder-mqtt-status"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
USER="${SUDO_USER:-$(whoami)}"
NODE_PATH="$(which node)"

cat <<EOF | sudo tee "$SERVICE_FILE" > /dev/null
[Unit]
Description=Trunk Recorder MQTT Status Server
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} ${INSTALL_DIR}/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=-${INSTALL_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

echo "Service '${SERVICE_NAME}' installed and started."
echo "Check status with: systemctl status ${SERVICE_NAME}"
