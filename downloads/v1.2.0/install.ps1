<#
.SYNOPSIS
    Installs Lens v1.2.0 from its GitHub release.

.DESCRIPTION
    Downloads the Lens v1.2.0 release assets, verifies their SHA256 checksums,
    extracts them to "$HOME\lens", and installs the VS Code extension when the
    `code` CLI is available. The Chrome extension is files-only; Chrome loads it
    manually (steps are printed at the end).

    Safety properties:
      - No administrator rights or elevation.
      - No registry writes.
      - The only network access is downloading release files from github.com.
      - Installation stops immediately if any checksum does not match.
      - Supports -WhatIf: prints what it would do without downloading or
        changing anything.

.EXAMPLE
    .\install.ps1
    .\install.ps1 -WhatIf
    .\install.ps1 -InstallDir "$HOME\tools\lens"
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # GitHub release tag to install.
    [string]$Release = "v1.2.0",

    # Directory the release files are extracted into.
    [string]$InstallDir = (Join-Path $HOME "lens")
)

$ErrorActionPreference = "Stop"

$BaseUrl = "https://raw.githubusercontent.com/PrachiDPatel/lens/main/downloads/$Release"
$Assets = @("lens-chrome.zip", "lens-vscode.vsix")   # files covered by SHA256SUMS
$ChecksumFile = "SHA256SUMS"

# ---------------------------------------------------------------------------
# -WhatIf plan: describe everything, change nothing.
# ---------------------------------------------------------------------------
if ($WhatIfPreference) {
    Write-Host "What if: download from $BaseUrl/"
    foreach ($f in ($Assets + $ChecksumFile)) { Write-Host "What if:   - $f" }
    Write-Host "What if: verify SHA256 of each asset against $ChecksumFile (stop on mismatch)"
    Write-Host "What if: extract lens-chrome.zip into $InstallDir"
    Write-Host "What if: copy lens-vscode.vsix into $InstallDir"
    Write-Host "What if: run 'code --install-extension lens-vscode.vsix' if the code CLI is on PATH"
    Write-Host "What if: print manual Chrome install steps"
    return
}

# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------
$tmpDir = New-Item -ItemType Directory -Force `
    -Path (Join-Path ([System.IO.Path]::GetTempPath()) "lens-install")
try {
    foreach ($f in ($Assets + $ChecksumFile)) {
        $url = "$BaseUrl/$f"
        $dest = Join-Path $tmpDir $f
        if ($PSCmdlet.ShouldProcess($url, "Download")) {
            Write-Host "Downloading $f ..."
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        }
    }

    # -----------------------------------------------------------------------
    # Verify SHA256 checksums. Any mismatch aborts the install.
    # -----------------------------------------------------------------------
    $expected = @{}
    foreach ($line in (Get-Content (Join-Path $tmpDir $ChecksumFile))) {
        if ($line -match '^\s*([0-9a-fA-F]{64})\s+(\S+)\s*$') {
            $expected[$matches[2]] = $matches[1].ToLower()
        }
    }
    foreach ($f in $Assets) {
        if (-not $expected.ContainsKey($f)) {
            throw "ERROR: no checksum entry for $f in $ChecksumFile. Aborting."
        }
        $actual = (Get-FileHash -Path (Join-Path $tmpDir $f) -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected[$f]) {
            throw ("ERROR: SHA256 mismatch for {0}.`n  expected: {1}`n  actual:   {2}`n" +
                   "The download may be corrupt or tampered with. Aborting.") -f $f, $expected[$f], $actual
        }
        Write-Host "Checksum OK: $f"
    }

    # -----------------------------------------------------------------------
    # Extract
    # -----------------------------------------------------------------------
    if ($PSCmdlet.ShouldProcess($InstallDir, "Extract release files")) {
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        Expand-Archive -Path (Join-Path $tmpDir "lens-chrome.zip") `
            -DestinationPath $InstallDir -Force
        Copy-Item -Path (Join-Path $tmpDir "lens-vscode.vsix") `
            -Destination (Join-Path $InstallDir "lens-vscode.vsix") -Force
        Write-Host "Extracted to $InstallDir"
    }

    # -----------------------------------------------------------------------
    # VS Code extension
    # -----------------------------------------------------------------------
    $vsixPath = Join-Path $InstallDir "lens-vscode.vsix"
    $codeCmd = Get-Command code -ErrorAction SilentlyContinue
    if ($codeCmd) {
        if ($PSCmdlet.ShouldProcess($vsixPath, "code --install-extension")) {
            & code --install-extension $vsixPath --force
            Write-Host "Lens VS Code extension installed."
        }
    }
    else {
        Write-Warning ("'code' CLI not found on PATH. Install the extension manually: " +
            "VS Code > Extensions view (...) > 'Install from VSIX...' > select $vsixPath")
    }
}
finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Chrome extension (manual step; Chrome requires user action)
# ---------------------------------------------------------------------------
$chromeDir = Join-Path $InstallDir "chrome"
Write-Host ""
Write-Host "Lens files are ready at: $InstallDir"
Write-Host ""
Write-Host "To finish the Chrome extension setup:"
Write-Host "  1. Open chrome://extensions in Chrome."
Write-Host "  2. Turn on 'Developer mode' (top right)."
Write-Host "  3. Click 'Load unpacked' and select this folder:"
Write-Host "       $chromeDir"
Write-Host ""
Write-Host "Done."
