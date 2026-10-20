$ErrorActionPreference = 'Stop'
$harnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $harnessRoot
try {
    npm install --prefix .selftest/real-wordpress --no-audit --no-fund --save-exact node@24.18.0 @wp-playground/cli@3.1.59
    if ($LASTEXITCODE -ne 0) { throw 'Contained runtime installation failed' }
    $wpVersion = if ($env:WPQA_REAL_WP) { $env:WPQA_REAL_WP } else { '6.8.3' }
    if ($wpVersion -notmatch '^\d+\.\d+(\.\d+)?$') { throw 'WPQA_REAL_WP must be a numeric release' }
    $archive = ".selftest/real-wordpress/wordpress-$wpVersion.zip"
    if (-not (Test-Path -LiteralPath $archive)) {
        curl.exe --location --fail --max-time 900 --retry 2 "https://wordpress.org/wordpress-$wpVersion.zip" --output "$archive.partial"
        if ($LASTEXITCODE -ne 0) { throw 'Official WordPress release download failed' }
        Move-Item -LiteralPath "$archive.partial" -Destination $archive
    }
    & .selftest/real-wordpress/node_modules/node/bin/node.exe test/real-wordpress/run.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Real WordPress verification failed; inspect .selftest/real-wordpress/evidence-*.json' }
}
finally { Pop-Location }
