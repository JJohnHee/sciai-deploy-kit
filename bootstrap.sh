#!/usr/bin/env bash
# SCAI 一键引导（Linux）：下载执行包 → systemd 常驻 → 自动连回 CD5 设备池
# 用法（新云机/任意 Tailscale 节点，root 执行）：
#   curl -fsSL https://github.com/JJohnHee/sciai-deploy-kit/raw/main/bootstrap.sh | bash
# 可选环境变量：
#   WORKER_NAME=自定义设备名   SCAI_DEVICE_TOKEN=引导令牌（必需，不再提供包内缺省令牌）
#   SCAI_API_URL=设备池地址    SCAI_WORKSPACE_ROOT=工作区路径（默认 /opt/sciai-worker/workspace）
set -e
[ -n "$SCAI_DEVICE_TOKEN" ] || { echo "[bootstrap] 缺少必需环境变量 SCAI_DEVICE_TOKEN"; exit 1; }
NAME="${WORKER_NAME:-$(hostname -s | tr 'A-Z' 'a-z')}"
DIR=/opt/sciai-worker
API="${SCAI_API_URL:-https://sciai-xuon16c32g.tailf48612.ts.net}"
TOKEN="$SCAI_DEVICE_TOKEN"
KIT="${SCAI_KIT_TGZ:-https://oneyear.tailf48612.ts.net/kit/sciai-kit.tgz}"

[ "$(id -u)" = 0 ] || { echo "[bootstrap] 需要 root（加 sudo）"; exit 1; }
command -v node >/dev/null || { echo "[bootstrap] 缺 node（需 ≥18）"; exit 1; }

mkdir -p "$DIR"
if [ ! -f "$DIR/sciai-worker.mjs" ]; then
  echo "[bootstrap] 下载执行包…"
  curl -fsSL -o /tmp/sciai-kit.tgz "$KIT"
  tar -xzf /tmp/sciai-kit.tgz -C "$DIR" --strip-components=1
fi

WS_ROOT="${SCAI_WORKSPACE_ROOT:-$DIR/workspace}"
mkdir -p "$WS_ROOT"

ENV_FILE=/etc/sciai-worker.env
umask 077
cat > "$ENV_FILE" <<EOF
WORKER_NAME=$NAME
CLAWSGO_API_URL=$API
CLAWSGO_DEVICE_TOKEN=$TOKEN
CLAWSGO_WORKSPACE_ROOT=$WS_ROOT
EOF
chmod 600 "$ENV_FILE"
umask 022

cat > /etc/systemd/system/sciai-worker.service <<EOF
[Unit]
Description=SCAI Worker ($NAME · CD5 设备池)
After=network-online.target
[Service]
WorkingDirectory=$DIR
EnvironmentFile=-$ENV_FILE
ExecStart=$(command -v node) $DIR/sciai-worker.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now sciai-worker
sleep 4
echo "[bootstrap] 设备 $NAME 已上线（systemd 常驻，开机自启）"
if curl -s -m 5 "$API/health" | grep -q "\"$NAME\""; then
  echo "  ✅ CD5 设备池已看到 $NAME"
else
  echo "  ⏳ 稍等几秒：curl -s $API/health | grep $NAME"
fi
echo "[bootstrap] 日志：journalctl -u sciai-worker -f"
