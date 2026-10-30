@echo off
rem Refreshes LamsEX's copy of the owen_ mods: textures to open, and which model each mob uses.
rem Run it again whenever the owen_ mods change. Optional: the mods folder, if it isn't found.
setlocal
set "HERE=%~dp0"
where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
%PY% -I "%HERE%tools\owen_mobs.py" "%HERE%." %1
echo.
pause
