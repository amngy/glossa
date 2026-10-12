# Registers the Glossa companion with Chrome, Edge and Brave for the current user (HKCU, no admin needed).
# Run once from this folder:  powershell -ExecutionPolicy Bypass -File install-windows.ps1
# Add -Download to also fetch the speech model now (about 3 GB from Hugging Face) and the Python packages.
param([switch]$Download)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
# Must match the `key` in apps/extension/wxt.config.ts.
$extensionId = 'ifjnjihdpegigjmpamidpemajjhabbme'

# Browsers start the host with their own PATH, which may predate the uv install: write uv's full path.
$uv = (Get-Command uv -ErrorAction Stop).Source
# --offline: after the first run uv must not contact PyPI each time the browser starts the companion.
Set-Content "$here\glossa-companion.cmd" "@echo off`r`n`"$uv`" run --offline --quiet --script `"%~dp0glossa_companion.py`"" -Encoding ascii

$manifest = @{
  name = 'com.glossa.companion'
  description = 'Glossa desktop companion: speech recognition on this computer'
  path = "$here\glossa-companion.cmd"
  type = 'stdio'
  allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json
Set-Content "$here\com.glossa.companion.json" $manifest -Encoding ascii

foreach ($key in 'Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser') {
  $path = "HKCU:\Software\$key\NativeMessagingHosts\com.glossa.companion"
  New-Item -Path $path -Force | Out-Null
  Set-ItemProperty -Path $path -Name '(default)' -Value "$here\com.glossa.companion.json"
}

if ($Download) { & $uv run --script "$here\glossa_companion.py" --download }
Write-Host 'Registered. Restart the browser, then load Glossa.'
