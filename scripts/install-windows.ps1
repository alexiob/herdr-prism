# Windows x64 bootstrap; plugin installation still uses Herdr's normal manifest.
[CmdletBinding()]
param(
    [string]$Ref = 'main',
    [switch]$Yes,
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$script:PrismNodeVersion = '24.21.0'
$script:PrismNodeArchiveSha = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$script:PrismNodeExeSha = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'

function Test-PrismNodeVersion([string]$Value) {
    if ($Value -notmatch '^v?(\d+)\.(\d+)\.(\d+)$') { return $false }
    return ([int]$Matches[1] -gt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 13))
}

function Assert-PrismRegularPath([string]$Path, [bool]$Directory) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.PSIsContainer -ne $Directory) {
        throw "Unsafe installer path: $Path"
    }
}

function Install-PrismNodeRuntime {
    param([string]$Directory, [string]$ArchivePath)
    $exe = Join-Path $Directory 'node.exe'
    if (Test-Path -LiteralPath $Directory) {
        Assert-PrismRegularPath $Directory $true
        Assert-PrismRegularPath $exe $false
        if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $script:PrismNodeExeSha) {
            throw 'Existing managed Node runtime differs from the pinned binary; refusing replacement.'
        }
        return $exe
    }
    $parent = Split-Path -Parent ([IO.Path]::GetFullPath($Directory))
    [void][IO.Directory]::CreateDirectory($parent)
    Assert-PrismRegularPath $parent $true
    $stage = Join-Path $parent ('.prism-node-' + [Guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $stage -ErrorAction Stop)
    try {
        if (-not $ArchivePath) {
            $ArchivePath = Join-Path $stage 'node.zip'
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$script:PrismNodeVersion/node-v$script:PrismNodeVersion-win-x64.zip" -OutFile $ArchivePath
        }
        Assert-PrismRegularPath $ArchivePath $false
        if ((Get-Item -LiteralPath $ArchivePath).Length -gt 67108864 -or (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $script:PrismNodeArchiveSha) {
            throw 'Node archive checksum mismatch; nothing was installed.'
        }
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath (Join-Path $stage 'unpacked')
        $extracted = Join-Path $stage "unpacked/node-v$script:PrismNodeVersion-win-x64"
        Assert-PrismRegularPath $extracted $true
        $candidate = Join-Path $extracted 'node.exe'
        Assert-PrismRegularPath $candidate $false
        if ((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $script:PrismNodeExeSha) { throw 'Extracted Node binary checksum mismatch.' }
        # Move to an absent destination. Never replace an existing installation.
        [IO.Directory]::Move($extracted, [IO.Path]::GetFullPath($Directory))
        return $exe
    }
    finally {
        # Only the exclusively named staging directory, under the checked parent.
        if ((Split-Path -Parent $stage) -ne $parent) { throw 'Unsafe installer cleanup path.' }
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}

function Set-PrismNodePath([string]$Directory) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($current -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $Directory.TrimEnd('\') })
    [Environment]::SetEnvironmentVariable('Path', (@($Directory) + $entries -join ';'), 'User')
    $env:PATH = $Directory + ';' + $env:PATH
    # Let Explorer refresh the environment used to launch new applications.
    try {
        if (-not ('PrismInstaller.Environment' -as [type])) {
            Add-Type -TypeDefinition @'
namespace PrismInstaller {
 public static class Environment {
  [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode, SetLastError=true)]
  public static extern System.IntPtr SendMessageTimeout(System.IntPtr window, uint message, System.UIntPtr wparam, string lparam, uint flags, uint timeout, out System.UIntPtr result);
 }
}
'@
        }
        $result = [UIntPtr]::Zero
        [void][PrismInstaller.Environment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
    }
    catch { Write-Verbose 'PATH was saved; restart the terminal if its launcher retains the old environment.' }
}

function Invoke-PrismWindowsInstall {
    param([string]$InstallRef = 'main', [switch]$AssumeYes, [switch]$OnlyPrepare)
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    if ($env:OS -ne 'Windows_NT' -or $architecture -ne 'AMD64') { throw 'This installer supports Windows x64 only.' }
    if ($InstallRef -notmatch '^[A-Za-z0-9_./-]{1,128}$' -or $InstallRef.StartsWith('-')) { throw 'Invalid Git ref.' }
    # Check Herdr before downloading Node. Do not replace or restart a live server.
    $herdr = Get-Command herdr.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $herdr) {
        $savedPath = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $env:PATH = $env:PATH + ';' + $savedPath
        $herdr = Get-Command herdr.exe -CommandType Application -ErrorAction SilentlyContinue
    }
    if (-not $herdr) { throw 'Install Herdr 0.9.3 or newer first: https://github.com/herdrdev/herdr/releases' }
    $herdrVersion = (& $herdr.Source --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $herdrVersion -notmatch '^herdr (\d+)\.(\d+)\.(\d+)\b') { throw 'Cannot determine the installed Herdr version.' }
    if ([version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" -lt [version]'0.9.3') { throw 'Herdr 0.9.3 or newer is required. Upgrade Herdr before running this installer.' }
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    $version = if ($node) { $output = (& $node.Source --version | Out-String).Trim(); if ($LASTEXITCODE -eq 0) { $output } else { '' } } else { '' }
    if (-not (Test-PrismNodeVersion $version)) {
        $directory = Join-Path $env:LOCALAPPDATA "Programs/node-v$script:PrismNodeVersion-win-x64"
        $nodeExe = Install-PrismNodeRuntime -Directory $directory
        Set-PrismNodePath $directory
        $version = (& $nodeExe --version | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not (Test-PrismNodeVersion $version)) { throw 'Installed Node runtime failed verification.' }
    }
    Write-Host "Ready: $herdrVersion; Node $version"
    if ($OnlyPrepare) { return }
    Write-Host 'If Herdr was running before Node setup, restart it when convenient before invoking plugin actions.'
    $listing = & $herdr.Source plugin list --plugin iob.herdr-prism --json
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect existing Prism registration.' }
    $plugins = ($listing | Out-String | ConvertFrom-Json).result.plugins
    if (@($plugins).Count -gt 0) {
        Write-Host 'Prism is already installed. For updates, deactivate it before reinstalling; see docs/install.md.'
        return
    }
    $arguments = @('plugin', 'install', 'alexiob/herdr-prism', '--ref', $InstallRef)
    if ($AssumeYes) { $arguments += '--yes' }
    & $herdr.Source @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Herdr plugin installation failed.' }
    Write-Host 'Install complete. Activate in your chosen Herdr session:'
    Write-Host '  herdr plugin action invoke activate-overview --plugin iob.herdr-prism'
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-PrismWindowsInstall -InstallRef $Ref -AssumeYes:$Yes -OnlyPrepare:$PrepareOnly }
    catch { Write-Error $_ -ErrorAction Continue; exit 1 }
}
