# SCAI 一键引导（Windows 云电脑版）：下载执行包 → 计划任务常驻 → 公网连回 CD5 设备池
# 用法（管理员 PowerShell）：
#   iwr https://oneyear.tailf48612.ts.net/kit/bootstrap.ps1 -UseBasicParsing | iex
# 前置：已装 Node.js（node -v 可用即可）；无需 Tailscale/无需入网（公网直连）
$ErrorActionPreference = 'Continue'

$API  = if ($env:SCAI_API_URL)  { $env:SCAI_API_URL }  else { 'https://sciai-xuon16c32g.tailf48612.ts.net' }
$TOKEN = if ($env:SCAI_DEVICE_TOKEN) { $env:SCAI_DEVICE_TOKEN } else { 'sci7-4681580d223b4fc493317a6bb77bee16' }
$NAME = if ($env:WORKER_NAME) { $env:WORKER_NAME } else { $env:COMPUTERNAME.ToLower() }
$DIR  = 'C:\sciai-worker'
$KIT  = if ($env:SCAI_KIT_TGZ) { $env:SCAI_KIT_TGZ } else { 'https://oneyear.tailf48612.ts.net/kit/sciai-kit.tgz' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[bootstrap] 缺 Node.js——先装：https://nodejs.org 任意 ≥18 LTS'; exit 1
}

if (-not (Test-Path "$DIR\sciai-worker.mjs")) {
  Write-Host '[bootstrap] 下载执行包…'
  New-Item -ItemType Directory -Force -Path $DIR | Out-Null
  Invoke-WebRequest -Uri $KIT -OutFile "$env:TEMP\sciai-kit.tgz" -UseBasicParsing
  tar -xzf "$env:TEMP\sciai-kit.tgz" -C $DIR --strip-components=1
}

$WS_ROOT = 'C:\sciai-worker\workspace'
New-Item -ItemType Directory -Force -Path $WS_ROOT | Out-Null

$bat = @(
  '@echo off',
  "cd /d $DIR",
  "set WORKER_NAME=$NAME",
  "set CLAWSGO_API_URL=$API",
  "set CLAWSGO_DEVICE_TOKEN=$TOKEN",
  "set CLAWSGO_WORKSPACE_ROOT=$WS_ROOT",
  "node `"$DIR\sciai-worker.mjs`" >> `"$DIR\worker.log`" 2>&1"
) -join "`r`n"
Set-Content -Path "$DIR\start-worker.bat" -Value $bat -Encoding ASCII

schtasks /create /tn SCAIWorker /tr "$DIR\start-worker.bat" /sc onstart /ru SYSTEM /f | Out-Null
schtasks /run /tn SCAIWorker | Out-Null
Start-Sleep -Seconds 6
Write-Host "[bootstrap] 设备 $NAME 已启动（计划任务常驻，开机自启）"
try {
  $h = Invoke-RestMethod -Uri "$API/health" -TimeoutSec 8
  if ($h.devices.name -contains $NAME) { Write-Host "  OK: CD5 设备池已看到 $NAME" }
  else { Write-Host '  等几秒后验证：iwr ' + "$API/health" }
} catch { Write-Host "  验证失败：$_" }
Write-Host "[bootstrap] 日志：Get-Content $DIR\worker.log -Tail 20 -Wait"
