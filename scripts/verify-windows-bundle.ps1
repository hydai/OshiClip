[CmdletBinding()]
param(
    [string]$BinaryPath,
    [string]$BundleRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($BinaryPath)) {
    $BinaryPath = Join-Path $repoRoot "src-tauri\target\x86_64-pc-windows-msvc\release\oshiclip.exe"
}
if ([string]::IsNullOrWhiteSpace($BundleRoot)) {
    $BundleRoot = Join-Path $repoRoot "src-tauri\target\x86_64-pc-windows-msvc\release\bundle"
}

$BinaryPath = [IO.Path]::GetFullPath($BinaryPath)
$BundleRoot = [IO.Path]::GetFullPath($BundleRoot)

if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    throw "Windows app binary not found: $BinaryPath"
}

$stream = [IO.File]::OpenRead($BinaryPath)
try {
    $reader = [IO.BinaryReader]::new($stream)
    $stream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) {
        throw "Not a valid PE executable: $BinaryPath"
    }
    $machine = $reader.ReadUInt16()
    if ($machine -ne 0x8664) {
        throw ("Expected an x64 PE executable, found machine type 0x{0:X4}" -f $machine)
    }
}
finally {
    $stream.Dispose()
}

$dumpbin = Get-Command "dumpbin.exe" -ErrorAction SilentlyContinue
if ($null -ne $dumpbin) {
    $dumpbinPath = $dumpbin.Source
}
else {
    $vswherePath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path -LiteralPath $vswherePath -PathType Leaf)) {
        throw "Visual Studio vswhere.exe was not found; cannot inspect PE imports."
    }

    $installationPath = (& $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($installationPath)) {
        throw "Visual C++ x64 tools were not found; cannot inspect PE imports."
    }

    $toolsVersionFile = Join-Path $installationPath "VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt"
    $toolsVersion = (Get-Content -LiteralPath $toolsVersionFile -Raw).Trim()
    $dumpbinPath = Join-Path $installationPath "VC\Tools\MSVC\$toolsVersion\bin\Hostx64\x64\dumpbin.exe"
    if (-not (Test-Path -LiteralPath $dumpbinPath -PathType Leaf)) {
        throw "dumpbin.exe was not found at $dumpbinPath"
    }
}

$dumpbinLines = & $dumpbinPath /DEPENDENTS $BinaryPath 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "dumpbin failed while reading $BinaryPath"
}
$dumpbinOutput = $dumpbinLines | Out-String
$imports = @(
    [regex]::Matches($dumpbinOutput, '(?im)^\s*([A-Za-z0-9._-]+\.dll)\s*$') |
        ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique
)
if ($imports.Count -eq 0) {
    throw "No PE imports were detected; dumpbin output format may have changed."
}

$dynamicCrtImports = @(
    $imports | Where-Object {
        $_ -match '^(api-ms-win-crt-|ucrtbase|msvcrt\.dll|msvcr\d+|msvcp\d+|vcruntime\d+|concrt\d+)'
    }
)
if ($dynamicCrtImports.Count -gt 0) {
    throw "Windows binary dynamically links the C/C++ runtime: $($dynamicCrtImports -join ', ')"
}

$systemDirectory = [Environment]::SystemDirectory
$nonSystemImports = @(
    $imports | Where-Object {
        if ($_ -match '^(api-ms-win-|ext-ms-)') {
            return $false
        }
        return -not (Test-Path -LiteralPath (Join-Path $systemDirectory $_) -PathType Leaf)
    }
)
if ($nonSystemImports.Count -gt 0) {
    throw "Windows binary imports non-system DLLs: $($nonSystemImports -join ', ')"
}

$bundledDlls = @(Get-ChildItem -LiteralPath (Split-Path $BinaryPath) -Filter "*.dll" -File)
if ($bundledDlls.Count -gt 0) {
    throw "Unexpected DLLs are bundled beside the app: $($bundledDlls.Name -join ', ')"
}

$nsisInstallers = @(Get-ChildItem -LiteralPath (Join-Path $BundleRoot "nsis") -Filter "*-setup.exe" -File)
$msiInstallers = @(Get-ChildItem -LiteralPath (Join-Path $BundleRoot "msi") -Filter "*.msi" -File)
if ($nsisInstallers.Count -eq 0 -or $msiInstallers.Count -eq 0) {
    throw "Expected both NSIS and MSI installers under $BundleRoot"
}

$signature = Get-AuthenticodeSignature -FilePath $BinaryPath
if ($env:REQUIRE_WINDOWS_SIGNATURE -eq "1" -and $signature.Status -ne "Valid") {
    throw "Authenticode signature is required but status is $($signature.Status)."
}
if ($signature.Status -ne "Valid") {
    Write-Warning "Authenticode status is $($signature.Status); use a trusted certificate before public distribution."
}

Write-Host "Verified x64 PE architecture and static MSVC CRT."
Write-Host "Imported Windows system DLLs: $($imports -join ', ')"
Write-Host "Found $($nsisInstallers.Count) NSIS installer and $($msiInstallers.Count) MSI installer."
