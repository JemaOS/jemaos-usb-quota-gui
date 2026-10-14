#!/usr/bin/env bash
# Copyright (c) 2026 The JemaOS Authors. All rights reserved.
# Installs a desktop entry so the tool appears in the apps menu and can be
# launched with a click on Linux.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
cat > "$APPS/quota-jemaos.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Quota JemaOS
Comment=Provisionner le quota d'installation signé sur une clé USB
Exec=bash -c 'cd "$DIR" && ./start.sh'
Path=$DIR
Icon=$DIR/ui/logo.svg
Terminal=true
Categories=Utility;
EOF
chmod +x "$APPS/quota-jemaos.desktop"
echo "Installé : $APPS/quota-jemaos.desktop"
echo "Cherche « Quota JemaOS » dans le menu des applications."
