@echo off
setlocal DisableDelayedExpansion
if "%~1"=="" exit /b 2
set "STOCKWISE_LOCAL_CONFIG=%~f1"
set "STOCKWISE_LOCAL_LAUNCH=%~dp0local-launch.ps1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "& ([scriptblock]::Create([IO.File]::ReadAllText([Environment]::GetEnvironmentVariable('STOCKWISE_LOCAL_LAUNCH', 'Process')))) -ConfigPath ([Environment]::GetEnvironmentVariable('STOCKWISE_LOCAL_CONFIG', 'Process'))"
exit /b %errorlevel%
