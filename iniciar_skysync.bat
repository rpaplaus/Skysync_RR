@echo off
cd /d "C:\Users\rpapl\.gemini\antigravity-ide\scratch\Skysync_RR"

uvicorn backend.app.main:app --reload --port 3000
pause