param([Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version)
$ErrorActionPreference = 'Stop'
$resourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stagePath = [IO.Path]::GetFullPath((Join-Path $resourceRoot "release/v$Version/yx_shellcreator"))
$archivePath = [IO.Path]::GetFullPath((Join-Path (Split-Path $resourceRoot -Parent) "yx_shellcreator-v$Version-build.zip"))
if (-not $stagePath.StartsWith($resourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path' }
if ((Test-Path -LiteralPath $stagePath) -or (Test-Path -LiteralPath $archivePath)) { throw 'Release already exists; refusing to overwrite it' }
$manifest = Get-Content -LiteralPath (Join-Path $resourceRoot 'fxmanifest.lua') -Raw
if ($manifest -notmatch ("version '" + [regex]::Escape($Version) + "'")) { throw 'Manifest version mismatch' }

Push-Location $resourceRoot
try {
    & dotnet build server/YxShellCreator.Server.csproj -c Release --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Server build failed' }
    foreach ($test in @('smoke','catalog-runtime','model-runtime','door-runtime','passage-runtime','house-runtime','environment-runtime')) {
        & node "tests/$test.js"
        if ($LASTEXITCODE -ne 0) { throw "Failed: $test" }
    }
    & node --check web/app.js
    if ($LASTEXITCODE -ne 0) { throw 'NUI syntax failed' }
    & dotnet run --project tests/HouseFiles/HouseFiles.Tests.csproj -c Release --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'House data tests failed' }

    New-Item -ItemType Directory -Path $stagePath | Out-Null
    foreach ($directory in @('client','config','database','stream','web')) {
        Copy-Item -LiteralPath (Join-Path $resourceRoot $directory) -Destination $stagePath -Recurse
    }
    foreach ($file in @('fxmanifest.lua','README.md','FEATURES.md','FURNITURE_PACKS.md','THIRD_PARTY_NOTICE.md','LICENSE','server.cfg.example')) {
        Copy-Item -LiteralPath (Join-Path $resourceRoot $file) -Destination $stagePath
    }
    New-Item -ItemType Directory -Path (Join-Path $stagePath 'exports'), (Join-Path $stagePath 'server/bin') | Out-Null
    Copy-Item -LiteralPath (Join-Path $resourceRoot 'exports/.keep') -Destination (Join-Path $stagePath 'exports/.keep')
    foreach ($dll in @('yx_shellcreator.Server.net.dll','Newtonsoft.Json.dll')) {
        Copy-Item -LiteralPath (Join-Path $resourceRoot "server/bin/$dll") -Destination (Join-Path $stagePath 'server/bin')
    }
    $files = @(Get-ChildItem -LiteralPath $stagePath -File -Recurse -Force)
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($stagePath.Length + 1)
        if ($relative -match '(^|[\\/])(tests|tools|obj|lib|\.git)([\\/]|$)|\.(cs|csproj|pdb|glb|ps1)$') { throw "Source file in build package: $relative" }
        if ($relative -like 'exports*' -and $relative -notmatch '^exports[\\/]\.keep$') { throw 'Player export data in build package' }
        $original = Join-Path $resourceRoot $relative
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $original).Hash) { throw "Staged file mismatch: $relative" }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stagePath,$archivePath,[IO.Compression.CompressionLevel]::Optimal,$true)
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($zip.Entries | Where-Object { $_.Name })
        if ($entries.Count -ne $files.Count) { throw 'Archive file count mismatch' }
        foreach ($entry in $entries) {
            $name = $entry.FullName.Replace('\','/')
            if (-not $name.StartsWith('yx_shellcreator/') -or $name.Contains('../')) { throw "Unexpected archive path: $name" }
            $stream = $entry.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
            finally { $sha.Dispose(); $stream.Dispose() }
            $source = Join-Path $resourceRoot $name.Substring('yx_shellcreator/'.Length)
            if ($hash -ne (Get-FileHash -LiteralPath $source).Hash) { throw "Archive content mismatch: $name" }
        }
    } finally { $zip.Dispose() }
    [pscustomobject]@{ Archive=$archivePath; FileCount=$files.Count; SizeMB=[Math]::Round((Get-Item -LiteralPath $archivePath).Length/1MB,2); SHA256=(Get-FileHash -LiteralPath $archivePath).Hash }
} finally { Pop-Location }
