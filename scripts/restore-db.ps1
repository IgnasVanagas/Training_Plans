param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$resolvedInputPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $InputPath))

if (-not (Test-Path $resolvedInputPath)) {
    throw "Backup file not found: $resolvedInputPath"
}

Write-Host "Restoring backup from $resolvedInputPath ..."
Get-Content -Raw $resolvedInputPath | docker-compose exec -T db psql -U app -d endurance

if ($LASTEXITCODE -ne 0) {
    throw "Restore failed with exit code $LASTEXITCODE"
}

Write-Host "Restore completed."