param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Refuse { throw 'LOCAL_NATIVE_LAUNCH_REFUSED' }
if ([IntPtr]::Size -ne 8 -or $ConfigPath -match '[`"\r\n]' -or -not [IO.Path]::IsPathRooted($ConfigPath)) { Refuse }
$launcherRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($launcherRoot)) {
  $launcherRoot = [IO.Path]::GetDirectoryName([Environment]::GetEnvironmentVariable('STOCKWISE_LOCAL_LAUNCH', 'Process'))
}
$node = 'C:\Program Files\nodejs\node.exe'
$entry = Join-Path $launcherRoot 'local-cli.mts'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $entry -PathType Leaf) -or -not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  Refuse
}
$names = @('PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE')
$child = @{}
foreach ($name in $names) {
  $value = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($null -ne $value) {
    if ($value.Contains([string][char]0)) { Refuse }
    $child[$name] = $value
  }
}
if (-not $child.ContainsKey('PATH') -or -not $child.ContainsKey('SystemRoot')) { Refuse }
$assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName('StockWiseLocalLauncher')), [Reflection.Emit.AssemblyBuilderAccess]::Run)
$type = $assembly.DefineDynamicModule('StockWiseLocalLauncher').DefineType('StockWiseLocalLauncher', 'Public,Sealed,Abstract')
function Native([string]$Name, [type]$Return, [type[]]$Parameters) {
  $method = $type.DefinePInvokeMethod($Name, 'kernel32.dll', 'Public,Static,PinvokeImpl', [Reflection.CallingConventions]::Standard,
    $Return, $Parameters, [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
  $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
}
Native 'CreateProcessW' ([bool]) @([string], [Text.StringBuilder], [IntPtr], [IntPtr], [bool], [uint32], [string], [string], [IntPtr], [IntPtr])
Native 'WaitForSingleObject' ([uint32]) @([IntPtr], [uint32])
Native 'GetExitCodeProcess' ([bool]) @([IntPtr], [IntPtr])
Native 'GetStdHandle' ([IntPtr]) @([int])
Native 'CloseHandle' ([bool]) @([IntPtr])
$native = $type.CreateType()
$startup = [Runtime.InteropServices.Marshal]::AllocHGlobal(104)
$info = [Runtime.InteropServices.Marshal]::AllocHGlobal(24)
$code = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
$processHandle = [IntPtr]::Zero
$threadHandle = [IntPtr]::Zero
try {
  for ($index = 0; $index -lt 104; $index++) { [Runtime.InteropServices.Marshal]::WriteByte($startup, $index, 0) }
  [Runtime.InteropServices.Marshal]::WriteInt32($startup, 104)
  [Runtime.InteropServices.Marshal]::WriteInt32($startup, 60, 256)
  [Runtime.InteropServices.Marshal]::WriteIntPtr($startup, 80, $native::GetStdHandle(-10))
  [Runtime.InteropServices.Marshal]::WriteIntPtr($startup, 88, $native::GetStdHandle(-11))
  [Runtime.InteropServices.Marshal]::WriteIntPtr($startup, 96, $native::GetStdHandle(-12))
  $quote = [string][char]34
  foreach ($argument in @($node, $entry, $ConfigPath)) { if ($argument.Contains($quote) -or $argument.EndsWith('\')) { Refuse } }
  $command = New-Object Text.StringBuilder(($quote + $node + $quote + ' --experimental-strip-types ' + $quote + $entry + $quote + ' ' + $quote + $ConfigPath + $quote))
  $block = ((@($child.Keys | Sort-Object | ForEach-Object { $_ + '=' + $child[$_] }) -join [char]0) + [char]0 + [char]0)
  if (-not $native::CreateProcessW($node, $command, [IntPtr]::Zero, [IntPtr]::Zero, $true, 1024, $block, $launcherRoot, $startup, $info)) { Refuse }
  $processHandle = [Runtime.InteropServices.Marshal]::ReadIntPtr($info)
  $threadHandle = [Runtime.InteropServices.Marshal]::ReadIntPtr($info, 8)
  if ($native::WaitForSingleObject($processHandle, [uint32]::MaxValue) -ne 0 -or -not $native::GetExitCodeProcess($processHandle, $code)) { Refuse }
  $exitCode = [Runtime.InteropServices.Marshal]::ReadInt32($code)
} catch {
  [Console]::Error.WriteLine('LOCAL_NATIVE_LAUNCH_REFUSED')
  exit 1
} finally {
  if ($threadHandle -ne [IntPtr]::Zero) { $null = $native::CloseHandle($threadHandle) }
  if ($processHandle -ne [IntPtr]::Zero) { $null = $native::CloseHandle($processHandle) }
  [Runtime.InteropServices.Marshal]::FreeHGlobal($startup)
  [Runtime.InteropServices.Marshal]::FreeHGlobal($info)
  [Runtime.InteropServices.Marshal]::FreeHGlobal($code)
}
exit $exitCode
