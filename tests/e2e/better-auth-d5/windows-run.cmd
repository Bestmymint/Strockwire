@echo off
setlocal
rem R2 exposes source verification only. No Docker or application execution.
node "%~dp0windows-run.mts"
exit /b %errorlevel%
