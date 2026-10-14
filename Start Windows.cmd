@echo off
rem Copyright (c) 2026 The JemaOS Authors. All rights reserved.
rem Windows launcher: checks Node.js, installs it via winget if missing,
rem then starts the app. Double-click this file.
setlocal
cd /d "%~dp0"

echo -- Quota JemaOS --

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est absent. Installation...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Installe Node.js LTS depuis https://nodejs.org/ puis relance ce fichier.
    pause
    exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js toujours introuvable. Ferme et rouvre ce fichier apres installation.
  pause
  exit /b 1
)

node bin\jemaos-quota-app.js
pause
