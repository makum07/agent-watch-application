#!/bin/bash
# Start AgentWatch with both WSL and Windows Claude session sources.
# Must be run from a WSL2 terminal.
#
# Usage (from a WSL2 terminal):
#   bash start.sh
#
# Usage (from Windows PowerShell / CMD):
#   wsl -d Ubuntu-24.04 -- bash -c "cd $(wslpath -u '%~dp0') && bash start.sh"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── WSL source ────────────────────────────────────────────────────────────────
# Default: current WSL user's ~/.claude. Override via env var if needed.
export CLAUDE_HOME_WSL="${CLAUDE_HOME_WSL:-$HOME/.claude}"

# ── Windows source ────────────────────────────────────────────────────────────
# Auto-detect Windows username so this works for any user on any machine.
if [ -z "$CLAUDE_HOME_WINDOWS" ]; then
    # Strategy 1: ask Windows directly (works when WSL2 can reach cmd.exe)
    WIN_USER=$(cmd.exe /C "echo %USERNAME%" 2>/dev/null | tr -d '\r\n')

    # Strategy 2: extract from project path if it lives under /mnt/c/Users/<user>/
    if [ -z "$WIN_USER" ]; then
        WIN_USER=$(echo "$SCRIPT_DIR" | sed -n 's|^/mnt/[a-z]/Users/\([^/]*\)/.*|\1|p')
    fi

    if [ -n "$WIN_USER" ]; then
        export CLAUDE_HOME_WINDOWS="/mnt/c/Users/$WIN_USER/.claude"
    else
        echo "Warning: could not detect Windows username. Windows source may not mount."
        echo "  Set CLAUDE_HOME_WINDOWS manually, e.g.:"
        echo "    CLAUDE_HOME_WINDOWS=/mnt/c/Users/<yourname>/.claude bash start.sh"
    fi
fi

echo "Starting AgentWatch..."
echo "  WSL source:     ${CLAUDE_HOME_WSL}"
[ -n "$CLAUDE_HOME_WINDOWS" ] && echo "  Windows source: ${CLAUDE_HOME_WINDOWS}"

cd "$SCRIPT_DIR"
docker compose down 2>/dev/null || true
docker compose up -d

PORT=$(grep -E '^PORT=' "$SCRIPT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '\r' || echo "3456")
echo ""
echo "AgentWatch running at http://localhost:${PORT}"
