#!/usr/bin/env bash
# Copyright (c) 2026 The JemaOS Authors. All rights reserved.
# Bootstrap launcher (Linux & macOS): checks Node.js, installs it if missing,
# then starts the app (local server + browser). Double-click or run ./start.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

have() { command -v "$1" >/dev/null 2>&1; }

echo "── Quota JemaOS ──"

if ! have node; then
  echo "Node.js est absent. Installation…"
  if have apt-get; then
    sudo apt-get update && sudo apt-get install -y nodejs npm
  elif have dnf; then
    sudo dnf install -y nodejs
  elif have pacman; then
    sudo pacman -S --noconfirm nodejs npm
  elif have zypper; then
    sudo zypper install -y nodejs
  elif have brew; then
    brew install node
  else
    echo "✖ Installe Node.js ≥ 18 depuis https://nodejs.org puis relance ce fichier."
    exit 1
  fi
fi

if ! have node; then
  echo "✖ Node.js toujours introuvable après installation. Relance ce fichier."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✖ Node ≥ 18 requis (tu as $(node -v)). Mets-le à jour puis relance."
  exit 1
fi

echo "Node $(node -v) OK — démarrage…"
exec node bin/jemaos-quota-app.js
