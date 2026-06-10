$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$Dist = Join-Path $Root "dist"

Set-Location (Join-Path $Root "status-monitor-client")

Write-Host "Installing dependencies..."
npm install

Write-Host "Building for Windows x64..."
npm run make -- --platform win32 --arch x64

# Copy installer to dist/ — overwrites if same name, never deletes existing files
$Exe = Get-ChildItem -Path "out\make\squirrel.windows" -Filter "*Setup*.exe" -Recurse | Select-Object -First 1
if (-not $Exe) {
    Write-Error "No installer found in out\make\squirrel.windows"
    exit 1
}

Copy-Item $Exe.FullName -Destination $Dist -Force
Write-Host ""
Write-Host "Done -> $Dist\$($Exe.Name)"

# Clean up temporary build output
Remove-Item -Recurse -Force "out"
