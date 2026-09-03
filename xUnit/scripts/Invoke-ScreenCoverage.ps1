[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ManifestPath,

    [string]$TestProject
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($manifest.screen)) {
    throw 'Manifest must contain a non-empty screen value.'
}

if ([string]::IsNullOrWhiteSpace($TestProject)) {
    $TestProject = $manifest.testProject
}
if ([string]::IsNullOrWhiteSpace($TestProject) -or -not (Test-Path -LiteralPath $TestProject)) {
    throw 'Pass an existing test project by -TestProject, or set testProject in the manifest.'
}

function Test-EvidenceReference {
    param([string]$Evidence)
    if ([string]::IsNullOrWhiteSpace($Evidence)) { return $false }
    # Require a concrete reference: a TC/E2E-style id, a file path, or a spec locator - not a bare assurance phrase.
    return ($Evidence -match '[A-Za-z]+-\d+') -or ($Evidence -match '[\\/]') -or ($Evidence -match ':')
}

# Validate `excluded` unconditionally - even a screen with no A/B targets can misuse classification C.
if (@($manifest.excluded | Where-Object { $_.classification -ne 'C' }).Count -gt 0) {
    throw 'Every excluded item must be classification C.'
}
if (@($manifest.excluded | Where-Object { -not (Test-EvidenceReference $_.evidence) }).Count -gt 0) {
    throw 'Every excluded item must include evidence as a concrete reference (e.g. "E2E-001", a spec file path, or "doc:section") - not a bare assurance phrase.'
}

$allTargets = @($manifest.targets)

if ($allTargets.Count -eq 0) {
    if ([string]::IsNullOrWhiteSpace($manifest.noTargetsReason)) {
        throw 'Manifest has no targets. Either add at least one A/B target, or set noTargetsReason to explain why this screen has no A/B code.'
    }
    Write-Host "Screen coverage gate: $($manifest.screen)"
    Write-Host "No A/B targets. Reason: $($manifest.noTargetsReason)"
    exit 0
}

$targets = @($allTargets | Where-Object { $_.classification -in @('A', 'B') })
if ($targets.Count -eq 0) {
    throw 'Manifest must contain at least one A or B target, or declare noTargetsReason with an empty targets array.'
}
if (@($allTargets | Where-Object { $_.classification -notin @('A', 'B') }).Count -gt 0) {
    throw 'targets may contain only A or B. Put C targets in excluded.'
}
if (@($targets | Where-Object { [string]::IsNullOrWhiteSpace($_.type) -or [string]::IsNullOrWhiteSpace($_.filter) }).Count -gt 0) {
    throw 'Every target must declare type and Coverlet filter.'
}

$include = ($targets.filter | Sort-Object -Unique) -join ','
$output = Join-Path 'TestResults/ScreenCoverage' $manifest.screen
$arguments = @(
    'test',
    $TestProject,
    '/p:CollectCoverage=true',
    "/p:CoverletOutput=$output/",
    '/p:CoverletOutputFormat=cobertura',
    "/p:Include=$include",
    '/p:Threshold=100,100',
    '/p:ThresholdType=line,branch',
    '/p:ThresholdStat=Total'
)

Write-Host "Screen coverage gate: $($manifest.screen)"
Write-Host "Included targets: $($targets.type -join ', ')"
& dotnet @arguments
exit $LASTEXITCODE
