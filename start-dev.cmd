@echo off
set "PATH=%~dp0.tools\node-v24.22.3-win-x64;%PATH%"
cd /d "%~dp0"
call npm.cmd run dev %*
