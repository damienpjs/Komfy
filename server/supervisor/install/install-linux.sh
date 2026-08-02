#!/usr/bin/env bash
# Install the Komfy supervisor as a systemd user service (Linux), enabled at
# boot. `enable-linger` lets it run on a headless server with no active login.
#
#   bash server/supervisor/install/install-linux.sh
#
# Uninstall:
#   systemctl --user disable --now komfy-supervisor
#   rm ~/.config/systemd/user/komfy-supervisor.service
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found on PATH — install Node first." >&2; exit 1; }

TEMPLATE="$REPO/server/supervisor/install/komfy-supervisor.service"
DEST="$HOME/.config/systemd/user/komfy-supervisor.service"
mkdir -p "$(dirname "$DEST")"

sed -e "s|@NODE@|$NODE|g" -e "s|@REPO@|$REPO|g" "$TEMPLATE" > "$DEST"

# Run without an interactive session (headless server).
loginctl enable-linger "$USER" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now komfy-supervisor

echo "✅ Installed $DEST"
echo "   Status: systemctl --user status komfy-supervisor"
echo "   Logs:   journalctl --user -u komfy-supervisor -f"
echo "   The supervisor generates its auth token on first run; then pair with:"
echo "     npm run pair"
