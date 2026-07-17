@echo off
cd /d C:\NeuroTracker\backend

if not exist logs mkdir logs

"C:\Program Files\nodejs\node.exe" server.js ^
  >> "C:\NeuroTracker\backend\logs\backend.log" 2>&1