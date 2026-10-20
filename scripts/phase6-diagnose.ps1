# scripts/phase6-diagnose.ps1
# Safe diagnostic launcher for the Sports Auction server (Phase 6 verification).
#
# - Starts the server on an isolated temp data directory (never touches ./data).
# - Waits for GET /api/health with a bounded, elapsed-time-reporting poll loop.
# - Uses netstat/tasklist only (CIM/WMI cmdlets such as Get-NetTCPConnection
#   have been observed to hang in some shells on this machine).
#
# Usage:
#   .\scripts\phase6-diagnose.ps1            # uses port 3998 by default
#   .\scripts\phase6-diagnose.ps1 -Port 3999
#   .\scripts\phase6-diagnose.ps1 -KeepServer   # leave server running after checks

param(
    [int]$Port = 3998,
    [int]$StartupTimeoutSec = 60,
    [switch]$KeepServer
)

$ErrorActionPreference = 'Stop'

# 1. Resolve project directory explicitly (parent of scripts/)
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir
Write-Host "Project:   $ProjectDir"

# 2. Verify entry files exist
if (-not (Test-Path (Join-Path $ProjectDir 'server.js'))) { throw 'server.js not found' }
if (-not (Test-Path (Join-Path $ProjectDir 'package.json'))) { throw 'package.json not found' }
Write-Host 'Entry:     server.js + package.json present'

# 3. Node / npm versions
Write-Host "Node:      $(node --version)"
Write-Host "npm:       $(npm --version)"

# 4. Dependencies installed?
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules\express'))) {
    throw 'Dependencies missing - run: npm install'
}
Write-Host 'Deps:      node_modules/express present'

# 5. Isolated test data directory (dedicated path; only this path is cleaned)
$DataDir = Join-Path ([System.IO.Path]::GetTempPath()) 'auction-phase6-diag'
if (Test-Path $DataDir) {
    $resolved = (Resolve-Path $DataDir).Path
    if ($resolved -ne $DataDir) { throw "Refusing to clean unexpected path: $resolved" }
    Write-Host "Cleaning:  $resolved (dedicated Phase 6 diag dir only)"
    Remove-Item -Path (Join-Path $DataDir '*') -Recurse -Force -ErrorAction SilentlyContinue
} else {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
    Write-Host "Created:   $DataDir"
}

# 6. Test environment (dev-only token, never a production credential)
$env:PORT = "$Port"
$env:DATA_DIR = $DataDir
$env:HOST_TOKEN = 'phase6-diag-dev-token'

# 7. Port occupancy check (netstat, not CIM)
Write-Host "Port $Port check..."
$listen = netstat -ano | Select-String ":$Port\s.*LISTENING"
if ($listen) {
    Write-Host "  OCCUPIED: $($listen[0].Line.Trim())"
    Write-Host '  -> Pick a free port: .\scripts\phase6-diagnose.ps1 -Port 4123'
    exit 2
}
Write-Host '  free'

# 8. Launch server with output captured
$outLog = Join-Path ([System.IO.Path]::GetTempPath()) 'phase6-diag-out.log'
$errLog = Join-Path ([System.IO.Path]::GetTempPath()) 'phase6-diag-err.log'
$nodeExe = (Get-Command node).Source
$serverJs = Join-Path $ProjectDir 'server.js'
Write-Host "Launching: $nodeExe $serverJs (logs: $outLog)"
$proc = Start-Process -FilePath $nodeExe `
    -ArgumentList "`"$serverJs`"" `
    -WorkingDirectory $ProjectDir `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru -WindowStyle Hidden

# 9. Bounded health-wait loop (startup can take ~10s cold from OneDrive paths)
$deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
$ok = $false
$elapsed = 0
Write-Host "Waiting for http://127.0.0.1:$Port/api/health (timeout ${StartupTimeoutSec}s)..."
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $elapsed++
    if ($proc.HasExited) { break }
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
        $ok = $true
        break
    } catch { }  # not up yet - keep polling
}

# 10. Report
function Show-Log($path, $label) {
    if (Test-Path $path) {
        $content = Get-Content $path -Raw -ErrorAction SilentlyContinue
        if ($content) { Write-Host "--- $label ---"; Write-Host $content.TrimEnd() }
    }
}

if ($ok) {
    Write-Host ("HEALTH OK after ~{0:N1}s: {1}" -f ($elapsed / 2), $r.Content)
    try {
        $state = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/state" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
        Write-Host ("STATE OK:   status={0} teams={1} players={2}" -f $state.auction.status, $state.teams.Count, $state.players.Count)
    } catch {
        Write-Host "STATE FAILED: $($_.Exception.Message)"
    }
    foreach ($page in '/index.html', '/live.html', '/view.html', '/conclusion.html') {
        try {
            $pr = Invoke-WebRequest -Uri "http://127.0.0.1:$Port$page" -UseBasicParsing -TimeoutSec 5
            Write-Host ("PAGE {0} -> {1}" -f $page, $pr.StatusCode)
        } catch {
            Write-Host ("PAGE {0} -> FAILED: {1}" -f $page, $_.Exception.Message)
        }
    }
    Show-Log $errLog 'STDERR'
    if (-not $KeepServer) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Write-Host 'Server stopped (pass -KeepServer to leave it running).'
    } else {
        Write-Host "Server left running on port $Port (PID $($proc.Id))."
    }
    exit 0
}

# 11/12. Failure path with exit code + next step
if ($proc.HasExited) {
    Write-Host "SERVER EXITED EARLY (exit code: $($proc.ExitCode))"
} else {
    Write-Host "STARTUP TIMEOUT after ${StartupTimeoutSec}s; server still running (PID $($proc.Id)) - not answering health."
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
Show-Log $outLog 'STDOUT'
Show-Log $errLog 'STDERR'
Write-Host 'Next steps:'
Write-Host '  - If STDERR shows EADDRINUSE: the port is taken; re-run with another -Port.'
Write-Host '  - If STDERR shows EACCES/ENOENT on DATA_DIR: check the temp path permissions.'
Write-Host '  - If logs are empty and it never listened: run in foreground: $env:PORT=...; node server.js'
exit 1
