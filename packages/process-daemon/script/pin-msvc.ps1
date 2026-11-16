# Zig 0.16 uses Clang 21. VS 2026's default 14.52 STL requires Clang 22.
# The ARM runner also ships the compatible 14.44 toolset; pin its headers and libraries together.
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -property installationPath
if ($LASTEXITCODE -ne 0 -or !$installation) { throw 'Visual Studio installation not found' }
$toolsets = Join-Path $installation 'VC/Tools/MSVC'
function Get-CompatibleMsvc {
    Get-ChildItem $toolsets -Directory |
        Where-Object {
            $_.Name -like '14.44.*' -and
            (Test-Path (Join-Path $_.FullName 'lib/arm64/msvcrt.lib')) -and
            (Test-Path (Join-Path $_.FullName 'lib/x64/msvcrt.lib'))
        } |
        Sort-Object Name -Descending |
        Select-Object -First 1
}
$toolset = Get-CompatibleMsvc
if (!$toolset) {
    # Rust's build scripts execute on x64 even when the final target is ARM64. The runner's
    # side-by-side 14.44 ARM component alone lacks the host CRT, so install both matching components.
    $installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/setup.exe'
    $install = Start-Process -FilePath $installer -ArgumentList @(
        'modify', '--installPath', "`"$installation`"",
        '--add', 'Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64',
        '--add', 'Microsoft.VisualStudio.Component.VC.14.44.17.14.ARM64',
        '--quiet', '--norestart'
    ) -Wait -PassThru
    if ($install.ExitCode -notin @(0, 3010)) { throw "MSVC installation failed: $($install.ExitCode)" }
    $toolset = Get-CompatibleMsvc
}
if (!$toolset) { throw 'MSVC 14.44 is required for the pinned Zig compiler' }
foreach ($file in @('include/vcruntime.h', 'include/yvals_core.h', 'lib/arm64/vcruntime.lib')) {
    if (!(Test-Path (Join-Path $toolset.FullName $file))) { throw "Missing MSVC component: $file" }
}
# Zig discovers MSVC through this file, not VCToolsVersion or the developer shell's environment.
Set-Content -Path (Join-Path $installation 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt') -Value $toolset.Name
Write-Output "Pinned Zig MSVC headers and libraries to $($toolset.FullName)"
