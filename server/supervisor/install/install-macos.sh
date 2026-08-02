#!/usr/bin/env bash
# Install the Komfy supervisor as a launchd LaunchAgent (macOS), started at
# login and kept alive. Idempotent: re-run to update after moving the repo.
#
#   bash server/supervisor/install/install-macos.sh
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.komfy.supervisor.plist
#   rm ~/Library/LaunchAgents/com.komfy.supervisor.plist
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found on PATH — install Node first." >&2; exit 1; }

TEMPLATE="$REPO/server/supervisor/install/com.komfy.supervisor.plist"
DEST="$HOME/Library/LaunchAgents/com.komfy.supervisor.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

sed -e "s|@NODE@|$NODE|g" -e "s|@REPO@|$REPO|g" -e "s|@HOME@|$HOME|g" \
  "$TEMPLATE" > "$DEST"

# Reload (unload is best-effort: it fails the first time, which is fine).
launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"

echo "✅ Installed $DEST"
echo "   Logs: $HOME/Library/Logs/komfy-supervisor.log"
echo "   The supervisor generates its auth token on first run; then pair with:"
echo "     npm run pair"
