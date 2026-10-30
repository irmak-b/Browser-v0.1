$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$display = (Get-Content -LiteralPath (Join-Path $projectRoot 'app-version.json') -Raw | ConvertFrom-Json).display
if ($display -notmatch '^V\d+\.\d+\.\d+\.\d+$') { throw 'Invalid app version' }
$folder = [IO.Path]::GetFullPath((Join-Path $projectRoot ('artifacts/BrowserCore_{0}_Windows_x64' -f $display)))
if (-not $folder.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Package outside workspace' }
if ((Get-Item -LiteralPath (Split-Path -Parent $folder)).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked artifact root' }
foreach ($item in @(Get-Item -LiteralPath $folder) + @(Get-ChildItem -LiteralPath $folder -Recurse -Force)) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked package entry' }
}
$manifest = @(Get-Content -LiteralPath (Join-Path $folder 'SHA256SUMS.txt'))
$files = @(Get-ChildItem -LiteralPath $folder -Recurse -File)
if ($files.Count -ne $manifest.Count + 1) { throw 'Unexpected package files; do not export user data' }
foreach ($line in $manifest) {
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid package manifest' }
    $expectedHash = $Matches[1]; $relative = $Matches[2]
    $path = [IO.Path]::GetFullPath((Join-Path $folder $relative))
    if (-not $path.StartsWith($folder + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path outside package' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Package differs from manifest' }
}
$archivePath = $folder + '.zip'
if (Test-Path -LiteralPath $archivePath) { throw 'Preserve existing Windows ZIP' }
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
$baseName = Split-Path -Leaf $folder
try {
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($folder.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $baseName + '/' + $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $files.Count) { throw 'ZIP entry count differs' }
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($folder.Length + 1).Replace('\','/')
        $entry = $archive.GetEntry($baseName + '/' + $relative)
        if (-not $entry) { throw 'Missing Windows ZIP entry' }
        $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
        try { $hash=[Convert]::ToHexString($sha.ComputeHash($stream)) } finally { $stream.Dispose();$sha.Dispose() }
        if ($hash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { throw 'Windows ZIP content differs' }
    }
} finally { $archive.Dispose() }
$zipHash=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($archivePath + '.sha256', $zipHash + '  ' + [IO.Path]::GetFileName($archivePath) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output "WINDOWS_ZIP_VERIFIED files=$($files.Count) bytes=$((Get-Item -LiteralPath $archivePath).Length) path=$archivePath"
Write-Output "SHA256=$zipHash"
