# SCAI Deploy Kit — GitHub 一键引导部署包

新机器（云电脑/服务器/WSL）**一条命令**下载整套执行包并自动连回 CD5 设备池，之后即可接活。

## 前置条件

1. 已装 **Node.js ≥ 18**（`node -v` 检查）
2. 已入 **Tailscale 网**（能 `curl http://100.94.124.54:8778/health`）
3. root / sudo 权限

## 一键引导（Linux / WSL）

```bash
curl -fsSL https://github.com/JJohnHee/sciai-deploy-kit/raw/main/bootstrap.sh | bash
```

装完自动：解包 → systemd 常驻（开机自启）→ 以本机 hostname 为设备名注册到 CD5 设备池（`ws://100.94.124.54:8778/device/ws`）。

## 自定义（可选）

```bash
WORKER_NAME=my-cloud-pc-1 curl -fsSL .../bootstrap.sh | bash
SCAI_WORKSPACE_ROOT=/data/workspace ... | bash
```

## 引导令牌（7 天有效）

包内默认带 7 天限时令牌（`sci7-` 前缀），过期后设备连不上：
- 有效期查询/续期：在 CD5 上改 `C:\clawsos\server\enroll-tokens.json`（`{"sci7-xxx": "ISO过期时间"}`），改完无需重启
- 长期机器建议改用主令牌（`CLAWSGO_DEVICE_TOKEN=clawsgo-device-...`）

## 装好后发生了什么

```
新机器 worker (systemd) ──WS──▶ CD5:8778 设备池（调度）
                                  │ 收到 turn.spawn
                                  ▼
                    worker 本地跑 loader（带工具干活）
                    模型调用 → oneyear:18900 池化网关（glm-5.3 / deepseek-flash…）
                                  │
                                  ▼
                    turn_stream / turn_exit 回传 → hub（8788/8789）→ 网页/桌面端
```

## 管理入口

- 主版：http://100.126.7.54:8788 （admin）
- CD5 独立版：http://100.94.124.54:8789 （admin，同账号库）
- 设备健康：`curl http://100.94.124.54:8778/health`

## 目录结构

```
├── bootstrap.sh        # 一键引导（上面那条命令）
├── install-linux.sh    # 手动安装（等价）
└── worker/
    ├── sciai-worker.mjs    # 执行器（与 clawsos daemon 协议对等）
    └── node_modules/ws     # 依赖随包，离线可用
```

## 卸载

```bash
systemctl disable --now sciai-worker && rm -rf /opt/sciai-worker /etc/systemd/system/sciai-worker.service
```
