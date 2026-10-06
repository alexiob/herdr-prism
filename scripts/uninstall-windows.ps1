# Standalone Windows removal: uses the same checked lifecycle implementation.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$installer = Invoke-RestMethod -Uri 'https://raw.githubusercontent.com/alexiob/herdr-prism/main/scripts/install-windows.ps1'
& ([scriptblock]::Create($installer)) -Uninstall
