# DIST-003 — Node-less installer for the `robota` CLI (Windows PowerShell).
#
#   irm https://raw.githubusercontent.com/woojubb/robota/main/scripts/install.ps1 | iex
#
# Downloads the DIST-002 windows-x64 release binary, integrity-verifies its SHA-256, installs it to
# %LOCALAPPDATA%\robota\bin, adds that dir to the USER PATH, and confirms via the absolute path. No Node.js.
$ErrorActionPreference = 'Stop'

# ── The ONLY place to change the download host ──────────────────────────────────────────────────────────────
$RobotaDownloadBase = if ($env:ROBOTA_DOWNLOAD_BASE) { $env:ROBOTA_DOWNLOAD_BASE } else { 'https://github.com/woojubb/robota/releases' }

# ── Arch: only windows-x64 is published. Fail loud on 32-bit; ARM64 runs under x64 emulation. ────────────────
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'x86') { throw 'install: 32-bit Windows is not supported (only x64).' }
if ($arch -eq 'ARM64') { Write-Host 'install: no native ARM64 build; using the x64 binary under emulation.' }
$asset = 'robota-windows-x64.exe'

# ── Version: default latest; ROBOTA_VERSION pins to a full v-prefixed tag (normalize a bare version) ─────────
if ($env:ROBOTA_VERSION) {
  $tag = if ($env:ROBOTA_VERSION.StartsWith('v')) { $env:ROBOTA_VERSION } else { "v$($env:ROBOTA_VERSION)" }
  $baseUrl = "$RobotaDownloadBase/download/$tag"
} else {
  $baseUrl = "$RobotaDownloadBase/latest/download"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("robota-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $assetPath = Join-Path $tmp $asset
  $sumsPath = Join-Path $tmp 'SHA256SUMS.txt'

  Write-Host "install: downloading $asset ($baseUrl)"
  Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile $assetPath -UseBasicParsing
  Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS.txt" -OutFile $sumsPath -UseBasicParsing

  # ── Integrity-verify (NOT authenticity — same-origin checksum) ────────────────────────────────────────────
  Write-Host 'install: verifying SHA-256'
  $expectedLine = (Get-Content $sumsPath | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" }) | Select-Object -First 1
  if (-not $expectedLine) { throw "install: no checksum entry for $asset" }
  $expected = ($expectedLine -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Path $assetPath -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "install: checksum mismatch for $asset — refusing to install" }

  # ── Install → %LOCALAPPDATA%\robota\bin\robota.exe ────────────────────────────────────────────────────────
  $binDir = Join-Path $env:LOCALAPPDATA 'robota\bin'
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $dest = Join-Path $binDir 'robota.exe'
  Copy-Item -Path $assetPath -Destination $dest -Force

  Write-Host "install: installed to $dest"
  & $dest --version   # verify via the ABSOLUTE path (a fresh PATH entry is inactive in this process)

  # ── Add to USER PATH via SetEnvironmentVariable — NEVER setx (it truncates PATH at 1024 chars) ────────────
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($userPath -split ';') -notcontains $binDir) {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $binDir } else { "$userPath;$binDir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "install: added $binDir to your user PATH (open a new terminal to use ``robota``)."
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
