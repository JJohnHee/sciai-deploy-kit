#!/usr/bin/env bash
# sciai-worker Linux 安装脚本（systemd 常驻）
# 用法：sudo bash install-linux.sh [WORKER_NAME]
set -e
cd "$(dirname "$0")"
NAME="${1:-$(hostname -s | tr 'A-Z' 'a-z')}"
API="${CLAWSGO_API_URL:-http://100.94.124.54:8778}"
TOKEN="${CLAWSGO_DEVICE_TOKEN:-clawsgo-device-d63fd189-5828-4fa0-ac25-ec29d733a887}"
WS_ROOT="${CLAWSGO_WORKSPACE_ROOT:-$(pwd)/workspace}"
mkdir -p "$WS_ROOT"

cat > sciai-worker.service <<EOF
[Unit]
Description=SCAI Worker (ClawsOS 设备执行包 name=$NAME)
After=network-online.target
[Service]
WorkingDirectory=$(pwd)
Environment=WORKER_NAME=$NAME
Environment=CLAWSGO_API_URL=$API
Environment=CLAWSGO_DEVICE_TOKEN=$TOKEN
Environment=CLAWSGO_WORKSPACE_ROOT=$WS_ROOT
ExecStart=$(which node) $(pwd)/sciai-worker.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

install -m 644 sciai-worker.service /etc/systemd/system/sciai-worker.service
systemctl daemon-reload && systemctl enable --now sciai-worker
sleep 2
echo "[install] sciai-worker 已启动 name=$NAME"
echo "[install] 验证：curl -s $API/health | grep $NAME"
