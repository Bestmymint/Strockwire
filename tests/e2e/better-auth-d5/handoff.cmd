@echo off
rem Source-tree launcher is intentionally inert. Only an independently deployed, pinned bootstrap may launch.
echo BLOCKED:INDEPENDENTLY_DEPLOYED_WINDOWS_BOOTSTRAP_REQUIRED 1>&2
exit /b 1
