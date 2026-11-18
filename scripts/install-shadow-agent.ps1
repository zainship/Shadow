# Installs Shadow Laptop Agent as a background logon task on Windows
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentScript = Join-Path $ScriptDir "shadow-laptop-agent.mjs"
$NodeExe = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $AgentScript)) {
  throw "Could not find $AgentScript"
}

$ShadowDir = Join-Path $env:USERPROFILE ".shadow-agent"
New-Item -ItemType Directory -Force -Path $ShadowDir | Out-Null

# Start immediately in background
& $NodeExe $AgentScript --daemon

# Register logon Scheduled Task so it runs automatically in background
$TaskName = "ShadowLaptopAgent"
$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$AgentScript`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null

Start-Sleep -Seconds 1
$TokenFile = Join-Path $ShadowDir "token.txt"
if (Test-Path $TokenFile) {
  Write-Host "`nShadow Pairing Token:" -ForegroundColor Cyan
  Get-Content $TokenFile
}
