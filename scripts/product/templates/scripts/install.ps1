# DIST-003 — Node-less installer for the selected CLI (Windows PowerShell).
#
# Select the installation script URL from PROJECT_INSTALL_SCRIPT_URL.
#
# Downloads the DIST-002 windows-x64 release binary, integrity-verifies its SHA-256, installs it to
# configured user state root/bin, adds that dir to the USER PATH, and confirms via the absolute path. No Node.js.
$ErrorActionPreference = 'Stop'

# ── The ONLY place to change the download host ──────────────────────────────────────────────────────────────
if ($null -eq $env:PRODUCT_CLI_NAME -and $null -eq $env:PROJECT_RELEASE_BASE_URL) {
  $env:PRODUCT_CLI_NAME = '__PRODUCT_CLI_NAME__'
  $env:PROJECT_RELEASE_BASE_URL = '__PROJECT_RELEASE_BASE_URL__'
  if (-not $env:PRODUCT_USER_STATE_DIR) { $env:PRODUCT_USER_STATE_DIR = Join-Path $env:LOCALAPPDATA '__PRODUCT_ID__' }
  $env:PROJECT_RELEASE_TAG_PREFIX = '__PROJECT_RELEASE_TAG_PREFIX__'
}
foreach ($name in @('PROJECT_RELEASE_BASE_URL', 'PRODUCT_USER_STATE_DIR', 'PRODUCT_CLI_NAME')) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "install: $name is required" }
}
if ($env:PRODUCT_CLI_NAME -notmatch '^[A-Za-z0-9._-]+$') { throw 'install: invalid PRODUCT_CLI_NAME' }
$artifactPrefix = if ($env:PRODUCT_ARTIFACT_PREFIX) { $env:PRODUCT_ARTIFACT_PREFIX } else { $env:PRODUCT_CLI_NAME }
if ($artifactPrefix -notmatch '^[A-Za-z0-9._-]+$') { throw 'install: invalid PRODUCT_ARTIFACT_PREFIX' }
if (-not [System.IO.Path]::IsPathRooted($env:PRODUCT_USER_STATE_DIR)) { throw 'install: PRODUCT_USER_STATE_DIR must be absolute' }
if (([Uri]$env:PROJECT_RELEASE_BASE_URL).Scheme -ne 'https') { throw 'install: PROJECT_RELEASE_BASE_URL must use HTTPS' }
$DownloadBase = $env:PROJECT_RELEASE_BASE_URL

# ── Arch: only windows-x64 is published. Fail loud on 32-bit; ARM64 runs under x64 emulation. ────────────────
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'x86') { throw 'install: 32-bit Windows is not supported (only x64).' }
if ($arch -eq 'ARM64') { Write-Host 'install: no native ARM64 build; using the x64 binary under emulation.' }
$asset = "$artifactPrefix-windows-x64.exe"

# ── Version: default latest; a configured tag prefix pins to an explicit release tag. ───────────────────────────────
if ($env:PROJECT_RELEASE_VERSION) {
  if (-not $env:PROJECT_RELEASE_TAG_PREFIX) { throw 'install: PROJECT_RELEASE_TAG_PREFIX is required' }
  $tag = if ($env:PROJECT_RELEASE_VERSION.StartsWith($env:PROJECT_RELEASE_TAG_PREFIX)) { $env:PROJECT_RELEASE_VERSION } else { "$($env:PROJECT_RELEASE_TAG_PREFIX)$($env:PROJECT_RELEASE_VERSION)" }
  $baseUrl = "$DownloadBase/download/$tag"
} else {
  $baseUrl = "$DownloadBase/latest/download"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-install-" + [System.Guid]::NewGuid().ToString('N'))
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

  # ── Install → configured user state root/bin/command.exe ────────────────────────────────────────────────────────
  $binDir = Join-Path $env:PRODUCT_USER_STATE_DIR 'bin'
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $dest = Join-Path $binDir "$($env:PRODUCT_CLI_NAME).exe"
  Copy-Item -Path $assetPath -Destination $dest -Force

  Write-Host "install: installed to $dest"
  & $dest --version   # verify via the ABSOLUTE path (a fresh PATH entry is inactive in this process)

  # ── Add to USER PATH via SetEnvironmentVariable — NEVER setx (it truncates PATH at 1024 chars) ────────────
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($userPath -split ';') -notcontains $binDir) {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $binDir } else { "$userPath;$binDir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "install: added $binDir to your user PATH (open a new terminal to use ``$($env:PRODUCT_CLI_NAME)``)."
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
