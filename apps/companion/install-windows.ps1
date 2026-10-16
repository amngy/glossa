# Registers the Glossa companion with Chrome, Edge and Brave for the current user (HKCU, no admin needed).
# Run once from this folder:  powershell -ExecutionPolicy Bypass -File install-windows.ps1
# Add -Download to also fetch the speech models now (about 3 GB from Hugging Face), the Python packages, and
# for live mode NVIDIA's NeMo-Speech.cpp runtime (about 100 MB from GitHub) with Nemotron 3.5 (about 740 MB).
# Add -Autostart to also start the local-port server (glossa-companion-server.cmd, for the "local port" setting)
# when you sign in. Without it, start that file yourself.
param([switch]$Download, [switch]$Autostart)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
# Must match the `key` in apps/extension/wxt.config.ts.
$extensionId = 'ifjnjihdpegigjmpamidpemajjhabbme'

# Browsers start the host with their own PATH, which may predate the uv install: write uv's full path.
$uv = (Get-Command uv -ErrorAction Stop).Source
# --offline: after the first run uv must not contact PyPI each time the browser starts the companion.
Set-Content "$here\glossa-companion.cmd" "@echo off`r`n`"$uv`" run --offline --quiet --script `"%~dp0glossa_companion.py`"" -Encoding ascii

# The same companion as a local server, for browsers that can't find the native host (Settings → Reach it over a local port).
Set-Content "$here\glossa-companion-server.cmd" "@echo off`r`n`"$uv`" run --offline --quiet --script `"%~dp0glossa_companion.py`" --serve" -Encoding ascii
if ($Autostart) {
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut("$([Environment]::GetFolderPath('Startup'))\Glossa companion.lnk")
  $shortcut.TargetPath = "$here\glossa-companion-server.cmd"
  $shortcut.WorkingDirectory = $here
  $shortcut.WindowStyle = 7  # minimized
  $shortcut.Save()
}

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

if ($Download) {
  & $uv run --script "$here\glossa_companion.py" --download
  # Pinned versions, checked against their published SHA-256 (the release's .sha256 file, Hugging Face's LFS hash).
  $nemotron = "$here\nemotron"
  $runtime = 'nemo-speech-0.2.0-windows-x86_64-cuda'
  $files = @(
    @{ url = "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/$runtime.zip"; sha256 = '9ffe5e842c39a7d3211f3b2c3b3aa1bca8c0b2455d96d961ed5f22ec5108f98d'; done = "$nemotron\$runtime\bin\nemo_speech_asr_c.dll" },
    @{ url = 'https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/ea30d66debe3740a08b573244286791d423d6b3e/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf'; sha256 = '3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1' }
  )
  New-Item -ItemType Directory -Force $nemotron | Out-Null
  $ProgressPreference = 'SilentlyContinue'  # the progress bar makes Invoke-WebRequest many times slower
  foreach ($file in $files) {
    $out = "$nemotron\$(Split-Path $file.url -Leaf)"
    if (Test-Path $(if ($file.done) { $file.done } else { $out })) { continue }
    Write-Host "Downloading $($file.url)"
    # Under another name until checked, so an interrupted download is never taken as done.
    Invoke-WebRequest $file.url -OutFile "$out.part"
    if ((Get-FileHash "$out.part" -Algorithm SHA256).Hash -ne $file.sha256) { Remove-Item "$out.part"; throw "Checksum mismatch: $($file.url)" }
    Move-Item "$out.part" $out -Force
    if ($file.done) { Expand-Archive $out $nemotron -Force; Remove-Item $out }
  }
}
Write-Host 'Registered. Restart the browser, then load Glossa.'
