# Windows x64 bootstrap; plugin installation still uses Herdr's normal manifest.
[CmdletBinding()]
param(
    [string]$Ref = 'main',
    [string]$Session,
    [switch]$InspectorOnly,
    [string]$SourceDir,
    [switch]$Yes,
    [switch]$PrepareOnly,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$script:PrismNodeVersion = '24.21.0'
$script:PrismNodeArchiveSha = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$script:PrismNodeExeSha = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'

function Test-PrismNodeVersion([string]$Value) {
    if ($Value -notmatch '^v?(\d+)\.(\d+)\.(\d+)$') { return $false }
    return ([int]$Matches[1] -gt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 13))
}

function Test-PrismNodeRuntime([string]$Version, [string]$Architecture) {
    return ((Test-PrismNodeVersion $Version) -and $Architecture -eq 'x64')
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

function Set-PrismShortcut {
    param([string]$ConfigPath, [string]$NodeExe, [string]$PluginRoot)
    $ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
    Assert-PrismRegularPath (Split-Path -Parent $ConfigPath) $true
    $exists = Test-Path -LiteralPath $ConfigPath
    if ($exists) {
        Assert-PrismRegularPath $ConfigPath $false
        $owner = [IO.File]::GetAccessControl($ConfigPath).GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Refusing to edit a Herdr config owned by another identity.' }
    }
    # Hold an exclusive handle through inspection and append; preserve the original
    # file's bytes, owner and ACL instead of replacing it with an inherited file.
    $mode = if ($exists) { [IO.FileMode]::Open } else { [IO.FileMode]::CreateNew }
    $stream = [IO.File]::Open($ConfigPath, $mode, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ($stream.Length -gt 2097152) { throw 'Herdr configuration exceeds 2 MiB.' }
        $bytes = New-Object byte[] ([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($count -eq 0) { throw 'Incomplete configuration read.' }
            $offset += $count
        }
        $inspect = @'
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
const {scanToml}=await import(pathToFileURL(join(process.argv[1],'dist/config/toml.js')));
const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(readFileSync(0,'utf8').trim(),'base64'));
const doc=scanToml(text);
const string=value=>{if(value.startsWith("'".repeat(3)))return undefined;if(value.startsWith('"')){try{return JSON.parse(value)}catch{return undefined}}if(value.startsWith("'")&&value.endsWith("'"))return value.slice(1,-1)};
const bindings=doc.entries.filter(e=>e.path.startsWith('keys.')&&string(e.value)?.toLowerCase()==='prefix+i');
let result='add';
if(bindings.length){result=bindings.length===1&&doc.entries.some(e=>e.tablePath===bindings[0].tablePath&&e.path.endsWith('.command')&&string(e.value)==='iob.herdr-prism.open')&&doc.entries.some(e=>e.tablePath===bindings[0].tablePath&&e.path.endsWith('.type')&&string(e.value)==='plugin_action')?'existing':'conflict'}
if(doc.entries.some(e=>e.path==='keys'||e.path==='keys.command')||doc.tables.some(t=>t.path==='keys.command'))result='conflict';
// TOML allows string forms beyond JSON. Preserve config rather than guess at
// an opaque binding containing multiline strings or TOML-only escapes.
if(doc.entries.some(e=>e.path.startsWith('keys.')&&/^["']/.test(e.value)&&string(e.value)===undefined))result='conflict';
console.log(result);
'@
        # Encode the fixed module to avoid legacy PowerShell native quote loss.
        # Only the small module enters the environment; config bytes use stdin.
        $env:PRISM_SHORTCUT_CODE = 'data:text/javascript;base64,' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($inspect))
        $decision = ([Convert]::ToBase64String($bytes) | & $NodeExe --input-type=module --eval 'await import(process.env.PRISM_SHORTCUT_CODE)' $PluginRoot | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Cannot safely inspect Herdr shortcut configuration; file unchanged.' }
        if ($decision -eq 'conflict') { Write-Warning 'prefix+i is already assigned or keys.command uses unsupported syntax; existing configuration preserved.'; return $false }
        if ($decision -eq 'existing') { Write-Host 'Prism shortcut already configured: prefix+i (default Ctrl+B, then I).'; return $false }
        if ($decision -ne 'add') { throw 'Unexpected shortcut inspection result.' }
        $backupPath = $ConfigPath + '.prism-shortcut.bak'
        if ($exists -and -not (Test-Path -LiteralPath $backupPath)) {
            $backup = [IO.File]::Open($backupPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                [IO.File]::SetAccessControl($backupPath, [IO.File]::GetAccessControl($ConfigPath))
                $backup.Write($bytes, 0, $bytes.Length); $backup.Flush($true)
            } finally { $backup.Dispose() }
        }
        $newline = if ([Text.Encoding]::UTF8.GetString($bytes).Contains("`r`n")) { "`r`n" } else { "`n" }
        $block = $newline + '# Prism Windows installer shortcut' + $newline + '[[keys.command]]' + $newline + 'key = "prefix+i"' + $newline + 'type = "plugin_action"' + $newline + 'command = "iob.herdr-prism.open"' + $newline + 'description = "Open Prism"' + $newline
        $addition = [Text.Encoding]::UTF8.GetBytes($block)
        try { $stream.Position = $stream.Length; $stream.Write($addition, 0, $addition.Length); $stream.Flush($true) }
        catch { $stream.SetLength($bytes.Length); $stream.Flush($true); throw }
        Write-Host 'Configured Prism: prefix+i (default Ctrl+B, then I). Close the focused Prism panel with Q.'
        return $true
    } finally {
        $stream.Dispose()
        Remove-Item Env:PRISM_SHORTCUT_CODE -ErrorAction SilentlyContinue
    }
}

function Update-PrismInstalledFile([string]$Path, [scriptblock]$Transform) {
    Assert-PrismRegularPath $Path $false
    $acl = [IO.File]::GetAccessControl($Path)
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Refusing to edit a plugin file owned by another identity.' }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ($stream.Length -gt 2097152) { throw 'Plugin file exceeds installer size limit.' }
        $bytes = New-Object byte[] ([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($count -eq 0) { throw 'Incomplete plugin file read.' }
            $offset += $count
        }
        $encoding = [Text.UTF8Encoding]::new($false, $true)
        $original = $encoding.GetString($bytes)
        $next = & $Transform $original
        if ($next -ceq $original) { return $false }
        $backupPath = $Path + '.prism-windows.bak'
        if (-not (Test-Path -LiteralPath $backupPath)) {
            $backup = [IO.File]::Open($backupPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { [IO.File]::SetAccessControl($backupPath, $acl); $backup.Write($bytes, 0, $bytes.Length); $backup.Flush($true) }
            finally { $backup.Dispose() }
        }
        $output = $encoding.GetBytes($next)
        try { $stream.Position = 0; $stream.Write($output, 0, $output.Length); $stream.SetLength($output.Length); $stream.Flush($true) }
        catch { $stream.Position = 0; $stream.Write($bytes, 0, $bytes.Length); $stream.SetLength($bytes.Length); $stream.Flush($true); throw }
        return $true
    } finally { $stream.Dispose() }
}

function Set-PrismInstalledRuntime([string]$PluginRoot, [string]$NodeExe) {
    Assert-PrismRegularPath $PluginRoot $true
    Assert-PrismRegularPath $NodeExe $false
    $quotedNode = ConvertTo-Json -Compress -InputObject ([IO.Path]::GetFullPath($NodeExe))
    $manifestChanged = Update-PrismInstalledFile (Join-Path $PluginRoot 'herdr-plugin.toml') {
        param($text)
        [regex]::Replace($text, '(?m)^(command\s*=\s*\[)\s*("(?:[^"\\]|\\.)*")(\s*,\s*"(?:dist/entrypoints/[a-z-]+\.js|scripts/check-install\.mjs)")', {
            param($match)
            $program = ConvertFrom-Json -InputObject $match.Groups[2].Value
            if ($program -eq 'node' -or ([IO.Path]::IsPathRooted($program) -and [IO.Path]::GetFileName($program) -ieq 'node.exe')) {
                return $match.Groups[1].Value + $quotedNode + $match.Groups[3].Value
            }
            return $match.Value
        })
    }
    # Windows installed-copy compatibility repair for releases whose open action
    # returns a pending promise inside finally { rpc.close() }. Shared sources
    # stay untouched; already-correct releases do not match these exact lines.
    $entryParent = Join-Path $PluginRoot 'dist'
    Assert-PrismRegularPath $entryParent $true
    $entryParent = Join-Path $entryParent 'entrypoints'
    Assert-PrismRegularPath $entryParent $true
    $actionChanged = Update-PrismInstalledFile (Join-Path $entryParent 'action.js') {
        param($text)
        [regex]::Replace($text, '(?m)^(\s*)return openPanel\(rpc(\);|, \{ existingPaneId: current\.paneId \}\);)', '$1return await openPanel(rpc$2')
    }
    if ($manifestChanged -or $actionChanged) { Write-Host 'Bound Windows plugin commands to the verified Node executable; legacy open cleanup repaired if needed.' }
    return ($manifestChanged -or $actionChanged)
}

function Get-PrismHerdrConfigPath {
    $configPath = $env:HERDR_CONFIG_PATH
    if (-not $configPath) {
        $base = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { $env:APPDATA }
        $configPath = Join-Path $base 'herdr/config.toml'
    }
    return $configPath
}

function Remove-PrismShortcut {
    param([string]$ConfigPath, [switch]$CheckOnly)
    if (-not (Test-Path -LiteralPath $ConfigPath)) { return $false }
    return (Update-PrismInstalledFile $ConfigPath {
        param($text)
        if (-not $text.Contains('# Prism Windows installer shortcut')) { return $text }
        if ([regex]::Matches($text, [regex]::Escape('# Prism Windows installer shortcut')).Count -ne 1) { throw 'Installer-owned Prism shortcut marker was duplicated; configuration and registration preserved.' }
        $pattern = '\r?\n# Prism Windows installer shortcut\r?\n\[\[keys\.command\]\]\r?\nkey = "prefix\+i"\r?\ntype = "plugin_action"\r?\ncommand = "iob\.herdr-prism\.open"\r?\ndescription = "Open Prism"\r?\n'
        $matches = [regex]::Matches($text, $pattern)
        if ($matches.Count -ne 1) { throw 'Installer-owned Prism shortcut was edited or duplicated; configuration and registration preserved.' }
        $match = $matches[0]
        $tail = $text.Substring($match.Index + $match.Length)
        $next = [regex]::Match($tail, '\A(?:[ \t]*(?:#[^\r\n]*)?\r?\n)*[ \t]*(?<line>[^\r\n]*)').Groups['line'].Value
        if ($next -and -not $next.StartsWith('[')) { throw 'Installer-owned Prism shortcut has additional fields; configuration and registration preserved.' }
        if ($CheckOnly) { return $text }
        return $text.Remove($match.Index, $match.Length)
    })
}

function Enable-PrismShortcut([string]$HerdrExe, [string]$NodeExe, [string]$PluginRoot) {
    $runtimeChanged = Set-PrismInstalledRuntime $PluginRoot $NodeExe
    $configPath = Get-PrismHerdrConfigPath
    $shortcutChanged = Set-PrismShortcut -ConfigPath $configPath -NodeExe $NodeExe -PluginRoot $PluginRoot
    if ($runtimeChanged -or $shortcutChanged) {
        & $HerdrExe server reload-config
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Shortcut saved. Start or reload Herdr to use it.' }
    }
}

function Invoke-PrismWindowsUninstall {
    if ($env:OS -ne 'Windows_NT') { throw 'This uninstaller supports Windows only.' }
    $env:PATH += ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $herdr = Get-Command herdr.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $configPath = Get-PrismHerdrConfigPath
    [void](Remove-PrismShortcut -ConfigPath $configPath -CheckOnly)
    $listing = & $herdr.Source plugin list --plugin iob.herdr-prism --json
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Prism registration; nothing removed.' }
    $plugins = ($listing | Out-String | ConvertFrom-Json).result.plugins
    if (@($plugins).Count -gt 0) {
        # Deactivation proves collector/pane cleanup before removing registration.
        $invoked = & $herdr.Source plugin action invoke deactivate --plugin iob.herdr-prism
        if ($LASTEXITCODE -ne 0) { throw 'Prism deactivation could not start; registration retained.' }
        $logId = ($invoked | Out-String | ConvertFrom-Json).result.log.log_id
        if (-not $logId) { throw 'Missing deactivation completion log; registration retained.' }
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $completed = $false
        while ([DateTime]::UtcNow -lt $deadline) {
            $logs = & $herdr.Source plugin log list --plugin iob.herdr-prism --limit 256
            if ($LASTEXITCODE -ne 0) { throw 'Cannot verify deactivation; registration retained.' }
            $entry = @(($logs | Out-String | ConvertFrom-Json).result.logs | Where-Object { $_.log_id -eq $logId -and $_.plugin_id -eq 'iob.herdr-prism' })
            if ($entry.Count -eq 1 -and $entry[0].status -eq 'failed') { throw 'Prism deactivation failed; registration retained. Inspect herdr plugin log list --plugin iob.herdr-prism.' }
            if ($entry.Count -eq 1 -and $entry[0].status -eq 'succeeded' -and $entry[0].exit_code -eq 0) { $completed = $true; break }
            Start-Sleep -Milliseconds 100
        }
        if (-not $completed) { throw 'Prism deactivation timed out; registration retained.' }
    }
    $changed = Remove-PrismShortcut -ConfigPath $configPath
    if ($changed) {
        & $herdr.Source server reload-config
        if ($LASTEXITCODE -ne 0) { throw 'Shortcut removed from disk; reload failed. Registration retained.' }
    }
    if (@($plugins).Count -gt 0) {
        & $herdr.Source plugin uninstall iob.herdr-prism
        if ($LASTEXITCODE -ne 0) { throw 'Herdr plugin uninstall failed.' }
        $listing = & $herdr.Source plugin list --plugin iob.herdr-prism --json
        if ($LASTEXITCODE -ne 0 -or @(($listing | Out-String | ConvertFrom-Json).result.plugins).Count -ne 0) { throw 'Cannot verify Prism registration removal.' }
    }
    Write-Host 'Prism uninstalled; installer-owned shortcut removed. User bindings, Node and retained plugin preferences are preserved.'
}

function Invoke-PrismWindowsInstall {
    param([string]$InstallRef = 'main', [switch]$AssumeYes, [switch]$OnlyPrepare, [string]$SessionName, [switch]$InspectOnly, [string]$ReviewedSource)
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    if ($env:OS -ne 'Windows_NT' -or $architecture -ne 'AMD64') { throw 'This installer supports Windows x64 only.' }
    if ($InstallRef -notmatch '^[A-Za-z0-9_./-]{1,128}$' -or $InstallRef.StartsWith('-')) { throw 'Invalid Git ref.' }
    # Check Herdr before downloading Node. Do not replace or restart a live server.
    $herdr = Get-Command herdr.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $herdr) {
        $savedPath = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $env:PATH = $env:PATH + ';' + $savedPath
        $herdr = Get-Command herdr.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $herdr) { throw 'Install Herdr 0.9.3 or newer first: https://github.com/herdrdev/herdr/releases' }
    $herdrVersion = (& $herdr.Source --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $herdrVersion -notmatch '^herdr (\d+)\.(\d+)\.(\d+)\b') { throw 'Cannot determine the installed Herdr version.' }
    if ([version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" -lt [version]'0.9.3') { throw 'Herdr 0.9.3 or newer is required. Upgrade Herdr before running this installer.' }
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $version = if ($node) { $output = (& $node.Source --version | Out-String).Trim(); if ($LASTEXITCODE -eq 0) { $output } else { '' } } else { '' }
    $nodeArchitecture = if ($node -and (Test-PrismNodeVersion $version)) { $output = (& $node.Source -p process.arch | Out-String).Trim(); if ($LASTEXITCODE -eq 0) { $output } else { '' } } else { '' }
    if (-not (Test-PrismNodeRuntime $version $nodeArchitecture)) {
        $directory = Join-Path $env:LOCALAPPDATA "Programs/node-v$script:PrismNodeVersion-win-x64"
        $nodeExe = Install-PrismNodeRuntime -Directory $directory
        Set-PrismNodePath $directory
        $version = (& $nodeExe --version | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not (Test-PrismNodeVersion $version)) { throw 'Installed Node runtime failed verification.' }
        $nodeArchitecture = (& $nodeExe -p process.arch | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not (Test-PrismNodeRuntime $version $nodeArchitecture)) { throw 'Installed Node runtime architecture failed verification.' }
    } else { $nodeExe = $node.Source }
    Write-Host "Ready: $herdrVersion; Node $version"
    if ($OnlyPrepare) { return }
    if ($SessionName -and ($SessionName -notmatch '^[A-Za-z0-9_.-]{1,128}$' -or $SessionName.StartsWith('-'))) { throw 'Invalid Herdr session name.' }
    # Download and validate new code before the shared updater stops any panel.
    # The exclusive temporary directory holds code only, never private state.
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('prism-source-' + [Guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $stage -ErrorAction Stop)
    try {
        if ($ReviewedSource) {
            $source = [IO.Path]::GetFullPath($ReviewedSource)
            Assert-PrismRegularPath $source $true
            $revision = $null
        } else {
            $download = Get-PrismSource -InstallRef $InstallRef -Directory $stage
            $source = $download.Root
            $revision = $download.Revision
        }
        $bootstrap = Join-Path $source 'scripts/bootstrap-windows.mjs'
        Assert-PrismRegularPath $bootstrap $false
        $arguments = @($bootstrap, '--root', $source, '--herdr-bin', $herdr.Source, '--ref', $InstallRef)
        if ($revision) { $arguments += @('--revision', $revision) }
        if ($SessionName) { $arguments += @('--session', $SessionName) }
        if ($InspectOnly) { $arguments += '--inspector-only' }
        & $nodeExe @arguments
        if ($LASTEXITCODE -ne 0) { throw 'Prism install/update failed. Private state retained; inspect the reported recovery information.' }
    } finally {
        Assert-PrismRegularPath $stage $true
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}

function Get-PrismSource {
    param([string]$InstallRef, [string]$Directory)
    if ($InstallRef -notmatch '^[A-Za-z0-9_./-]{1,128}$' -or $InstallRef.StartsWith('-')) { throw 'Invalid Git ref.' }
    Assert-PrismRegularPath $Directory $true
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $commitPath = Join-Path $Directory 'commit.json'
    $encoded = [Uri]::EscapeDataString($InstallRef)
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'herdr-prism-installer' } -Uri "https://api.github.com/repos/alexiob/herdr-prism/commits/$encoded" -OutFile $commitPath
    Assert-PrismRegularPath $commitPath $false
    if ((Get-Item -LiteralPath $commitPath).Length -gt 65536) { throw 'GitHub revision response exceeds the installer limit.' }
    $revision = (Get-Content -LiteralPath $commitPath -Raw | ConvertFrom-Json).sha
    if ($revision -notmatch '^[a-f0-9]{40}$') { throw 'Invalid immutable GitHub revision.' }
    Write-Host "Prism: preparing alexiob/herdr-prism at $revision"
    $archive = Join-Path $Directory 'prism.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/alexiob/herdr-prism/zip/$revision" -OutFile $archive
    Assert-PrismRegularPath $archive $false
    if ((Get-Item -LiteralPath $archive).Length -gt 134217728) { throw 'Prism source archive exceeds the installer limit.' }
    $unpacked = Join-Path $Directory 'source'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    $roots = @(Get-ChildItem -LiteralPath $unpacked -Directory)
    if ($roots.Count -ne 1 -or $roots[0].Name -ne "herdr-prism-$revision") { throw 'Unexpected immutable Prism archive root.' }
    Assert-PrismRegularPath $roots[0].FullName $true
    return [PSCustomObject]@{ Root = $roots[0].FullName; Revision = $revision }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($Uninstall) { Invoke-PrismWindowsUninstall }
        else { Invoke-PrismWindowsInstall -InstallRef $Ref -AssumeYes:$Yes -OnlyPrepare:$PrepareOnly -SessionName $Session -InspectOnly:$InspectorOnly -ReviewedSource $SourceDir }
    }
    catch { Write-Error $_ -ErrorAction Continue; exit 1 }
}
