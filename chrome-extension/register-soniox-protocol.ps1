$ErrorActionPreference = 'Stop'

function Find-SonioxExecutable {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Soniox\Soniox.exe",
        "$env:LOCALAPPDATA\Soniox\Soniox.exe",
        "$env:PROGRAMFILES\Soniox\Soniox.exe",
        "$env:PROGRAMFILES(X86)\Soniox\Soniox.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }

    $roots = @($env:LOCALAPPDATA, $env:PROGRAMFILES, ${env:PROGRAMFILES(X86)}) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($root in $roots) {
        $match = Get-ChildItem -Path $root -Filter 'Soniox.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) { return $match.FullName }
    }

    return $null
}

$exe = Find-SonioxExecutable
if (-not $exe) {
    Write-Host 'Soniox.exe was not found automatically.' -ForegroundColor Yellow
    $exe = Read-Host 'Paste the full path to Soniox.exe'
    if (-not (Test-Path $exe)) {
        throw "File not found: $exe"
    }
    $exe = (Resolve-Path $exe).Path
}

$protocolRoot = 'HKCU:\Software\Classes\mindcrafti-soniox'
New-Item -Path $protocolRoot -Force | Out-Null
Set-ItemProperty -Path $protocolRoot -Name '(default)' -Value 'URL:Mindcrafti Soniox Launcher'
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

$commandKey = Join-Path $protocolRoot 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $commandKey -Name '(default)' -Value ('"' + $exe + '"')

Write-Host ''
Write-Host 'Mindcrafti Soniox launcher installed.' -ForegroundColor Green
Write-Host ('Soniox path: ' + $exe)
Write-Host 'Now clicking Start lesson can open the Soniox desktop app.'
