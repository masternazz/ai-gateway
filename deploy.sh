#!/bin/bash
# deploy.sh — push ai-gateway to your remote server
# Usage: ./deploy.sh user@yourserver
# Requires: ssh access to the server, scp
set -e

REMOTE="${1:-root@yourserver}"
DEST="/opt/ai-gateway"
SSH="ssh -o StrictHostKeyChecking=no"
SCP="scp -o StrictHostKeyChecking=no"

echo "==> Deploying to $REMOTE:$DEST"
$SSH "$REMOTE" "mkdir -p $DEST/src $DEST/repos $DEST/history"

# Sync source files
$SCP -r src package.json ai-gateway.service "$REMOTE:$DEST/"

# Copy .env if present locally (won't overwrite if already on server)
if [ -f .env ]; then
  echo "==> Copying .env"
  $SCP .env "$REMOTE:$DEST/.env"
fi

# Copy memory template if no memory.md exists yet on server
$SSH "$REMOTE" "[ -f $DEST/memory.md ] || true"
if ! $SSH "$REMOTE" "test -f $DEST/memory.md"; then
  echo "==> Copying memory template"
  $SCP memory.example.md "$REMOTE:$DEST/memory.md"
fi

# Install dependencies
echo "==> Installing npm dependencies"
$SSH "$REMOTE" "cd $DEST && npm install --omit=dev"

# Install and enable systemd service
echo "==> Installing systemd service"
$SSH "$REMOTE" "cp $DEST/ai-gateway.service /etc/systemd/system/ai-gateway.service && systemctl daemon-reload && systemctl enable ai-gateway"

echo ""
echo "Done! Next steps:"
echo "  1. Authenticate CLIs on the server:"
echo "     ssh $REMOTE"
echo "     claude login"
echo "     gemini auth"
echo "     codex login --device-auth"
echo ""
echo "  2. Start the service:"
echo "     ssh $REMOTE 'systemctl start ai-gateway'"
echo "     ssh $REMOTE 'journalctl -u ai-gateway -f'"
