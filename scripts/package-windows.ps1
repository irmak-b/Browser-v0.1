param()
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$versionInfo = Get-Content -LiteralPath (Join-Path $projectRoot 'app-version.json') -Raw | ConvertFrom-Json
if ($versionInfo.display -notmatch '^V\d+\.\d+\.\d+\.\d+$') { throw 'Invalid app version' }
$runtimeRoot = Join-Path $projectRoot 'node_modules/electron/dist'
$buildRoot = Join-Path $projectRoot 'out'
$destination = [IO.Path]::GetFullPath((Join-Path $projectRoot ('artifacts/BrowserCore_{0}_Windows_x64' -f $versionInfo.display)))
if (-not $destination.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Package outside workspace' }
if ((Test-Path -LiteralPath (Join-Path $projectRoot 'artifacts')) -and ((Get-Item -LiteralPath (Join-Path $projectRoot 'artifacts')).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked artifact directory forbidden' }
if (Test-Path -LiteralPath $destination) { throw 'Preserve existing package; choose a new build revision' }
$installed = Get-Content -LiteralPath (Join-Path $projectRoot 'node_modules/electron/package.json') -Raw | ConvertFrom-Json
$expected = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).devDependencies.electron
if ($installed.version -ne $expected -or (Get-Content -LiteralPath (Join-Path $runtimeRoot 'version') -Raw).Trim().TrimStart('v') -ne $expected) { throw 'Runtime version mismatch; no download started' }
foreach ($relative in @('main/index.js','preload/index.cjs','renderer/index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $buildRoot $relative) -PathType Leaf)) { throw 'Build missing; run local build first' }
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'electron.exe') -PathType Leaf)) { throw 'Local runtime missing; no download started' }
if (Test-Path -LiteralPath (Join-Path $runtimeRoot 'resources/app')) { throw 'Unexpected application inside runtime' }
foreach ($rootPath in @($runtimeRoot,$buildRoot)) {
    foreach ($entry in @(Get-Item -LiteralPath $rootPath) + @(Get-ChildItem -LiteralPath $rootPath -Recurse -Force)) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked package input forbidden' }
        if ($entry.Name -match '^\.env($|\.)|^(profiles|userData|\.cache|node_modules)$') { throw 'Unexpected package input' }
    }
}
$runtimeFiles = @(Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File)
$buildFiles = @(Get-ChildItem -LiteralPath $buildRoot -Recurse -File)
$requiredBytes = (($runtimeFiles + $buildFiles | Measure-Object Length -Sum).Sum * 2) + 104857600
if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($destination)).AvailableFreeSpace -lt $requiredBytes) { throw 'Insufficient space for package and archive' }
New-Item -ItemType Directory -Path $destination | Out-Null
foreach ($item in Get-ChildItem -LiteralPath $runtimeRoot -Force) { Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse }
Move-Item -LiteralPath (Join-Path $destination 'electron.exe') -Destination (Join-Path $destination 'BrowserCore.exe')
$appRoot = Join-Path $destination 'resources/app'
New-Item -ItemType Directory -Path $appRoot | Out-Null
Copy-Item -LiteralPath $buildRoot -Destination (Join-Path $appRoot 'out') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/third-party/adblock') -Destination (Join-Path $appRoot 'third-party-adblock') -Recurse
[ordered]@{name='browser-core';productName='Browser Core';version=$versionInfo.package;private=$true;main='out/main/index.js'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'package.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/WINDOWS_CALISTIR_TR.txt') -Destination (Join-Path $destination 'BASLAT_TR.txt')
foreach ($source in $runtimeFiles + $buildFiles) {
    $isRuntime = $source.FullName.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    $relative = $source.FullName.Substring($(if ($isRuntime) { $runtimeRoot.Length } else { $buildRoot.Length }) + 1)
    $copied = if ($isRuntime) { Join-Path $destination $(if ($relative -eq 'electron.exe') { 'BrowserCore.exe' } else { $relative }) } else { Join-Path $appRoot ('out/' + $relative) }
    if ((Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $copied -Algorithm SHA256).Hash) { throw 'Copied file differs' }
}
$exe = Get-Item -LiteralPath (Join-Path $destination 'BrowserCore.exe')
[ordered]@{appVersion=$versionInfo.display;packageVersion=$versionInfo.package;electronVersion=$expected;architecture='win32-x64';format='unpacked-folder';executable='BrowserCore.exe';executableFileVersion=$exe.VersionInfo.FileVersion;executableProductVersion=$exe.VersionInfo.ProductVersion;executableResourcesModified=$false;appCodeSigned=$false;runtimeFiles=$runtimeFiles.Count;newDownloads=0;backend='not-connected';ui='DevShell'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'PACKAGE_INFO.json') -Encoding utf8
$manifest = foreach ($file in Get-ChildItem -LiteralPath $destination -Recurse -File) {
    (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $file.FullName.Substring($destination.Length + 1).Replace('\','/')
}
[IO.File]::WriteAllLines((Join-Path $destination 'SHA256SUMS.txt'), [string[]]($manifest | Sort-Object), [Text.UTF8Encoding]::new($false))
Write-Output "WINDOWS_FOLDER_VERIFIED path=$destination files=$($manifest.Count) bytes=$((Get-ChildItem -LiteralPath $destination -Recurse -File | Measure-Object Length -Sum).Sum)"
