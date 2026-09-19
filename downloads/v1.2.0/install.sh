#!/bin/sh
# install.sh — Install Lens v1.2.0 from its GitHub release (macOS / Linux).
#
# What it does:
#   1. Downloads lens-chrome.zip, lens-vscode.vsix, and SHA256SUMS from the
#      Lens v1.2.0 GitHub release.
#   2. Verifies SHA256 checksums. Stops immediately on any mismatch.
#   3. Extracts everything to "$HOME/lens".
#   4. Installs the VS Code extension via `code --install-extension` when the
#      `code` CLI is on PATH (warns otherwise).
#   5. Prints the manual Chrome steps (Chrome requires user action).
#
# Safety properties:
#   - No sudo / root needed, no system files touched.
#   - The only network access is downloading release files from github.com.
#   - Needs: curl, unzip, and sha256sum (or shasum -a 256).
#
# Usage:
#   sh install.sh
#   RELEASE=v2.0.0 sh install.sh        # install a different tag
#   INSTALL_DIR="$HOME/tools/lens" sh install.sh
set -eu

RELEASE="${RELEASE:-v1.2.0}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/lens}"
BASE_URL="https://raw.githubusercontent.com/PrachiDPatel/lens/main/downloads/${RELEASE}"
ASSETS="lens-chrome.zip lens-vscode.vsix"
CHECKSUM_FILE="SHA256SUMS"

need() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: required tool '$1' not found on PATH" >&2
        exit 1
    }
}
need curl
need unzip
if command -v sha256sum >/dev/null 2>&1; then
    SHA256SUM="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    SHA256SUM="shasum -a 256"
else
    echo "error: need 'sha256sum' or 'shasum' on PATH" >&2
    exit 1
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT INT TERM

echo "Downloading Lens ${RELEASE} ..."
for f in $ASSETS $CHECKSUM_FILE; do
    curl -fsSL --proto '=https' -o "$TMPDIR/$f" "$BASE_URL/$f"
done

echo "Verifying SHA256 checksums ..."
(cd "$TMPDIR" && $SHA256SUM -c "$CHECKSUM_FILE")
# shasum/sha256sum -c exits non-zero on any mismatch; with `set -e` that
# aborts the install here before anything is extracted.

echo "Extracting to ${INSTALL_DIR} ..."
mkdir -p "$INSTALL_DIR"
unzip -o -q "$TMPDIR/lens-chrome.zip" -d "$INSTALL_DIR"
cp "$TMPDIR/lens-vscode.vsix" "$INSTALL_DIR/lens-vscode.vsix"

if command -v code >/dev/null 2>&1; then
    code --install-extension "$INSTALL_DIR/lens-vscode.vsix" --force
    echo "Lens VS Code extension installed."
else
    echo "warning: 'code' CLI not found on PATH." >&2
    echo "Install the extension manually: VS Code > Extensions view (...) >" >&2
    echo "'Install from VSIX...' > select $INSTALL_DIR/lens-vscode.vsix" >&2
fi

echo ""
echo "Lens files are ready at: $INSTALL_DIR"
echo ""
echo "To finish the Chrome extension setup:"
echo "  1. Open chrome://extensions in Chrome."
echo "  2. Turn on 'Developer mode' (top right)."
echo "  3. Click 'Load unpacked' and select this folder:"
echo "       $INSTALL_DIR/chrome"
echo ""
echo "Done."
