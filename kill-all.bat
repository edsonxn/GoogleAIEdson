@echo off
echo Matando procesos Node.js...
taskkill /F /IM node.exe >nul 2>&1
echo Matando procesos en puerto 6969 (Applio)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :6969 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo.
echo Done. Todos los procesos cerrados.
timeout /t 2
