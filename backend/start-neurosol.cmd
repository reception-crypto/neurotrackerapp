@echo off
cd /d "%~dp0"

if not exist logs mkdir logs

"%ProgramFiles%\nodejs\node.exe" server.js ^
  >> "%~dp0logs\backend.log" 2>&1
