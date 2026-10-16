@echo off
echo Iniciando o Skysync em ambiente isolado (Porta 8000)...
echo Protegendo containers do TVDE-PILOT...

:: 1. Inicia o backend FastAPI em uma nova janela de terminal
start "Skysync Backend" cmd /k ".\.venv\Scripts\activate && uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload"

:: 2. Aguarda 3 segundos para o servidor subir
timeout /t 3 /nobreak >nul

:: 3. Inicia o Ngrok na janela principal
ngrok http 127.0.0.1:8000