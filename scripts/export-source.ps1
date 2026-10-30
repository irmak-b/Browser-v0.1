param([ValidateSet('A1','A2','A3','A4','A5','P1','P2')][string]$Stage = 'A5', [ValidateSet('','Dogrulama','VideoZamanlama','FiltreTema','VideoCpuPlan','Cache','CacheVideo','KarmaYuk','GitHub')][string]$SnapshotLabel = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts'))
if (-not $artifactDirectory.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path outside project' }
if (Test-Path -LiteralPath $artifactDirectory) {
    if ((Get-Item -LiteralPath $artifactDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Artifact directory is a link' }
} else { New-Item -ItemType Directory -Path $artifactDirectory | Out-Null }
$appVersion = Get-Content -LiteralPath (Join-Path $projectRoot 'app-version.json') -Raw | ConvertFrom-Json
if ($appVersion.display -notmatch '^V\d+\.\d+\.\d+\.\d+$') { throw 'Invalid display version' }
$recordSuffix = if ($SnapshotLabel) { '_' + $SnapshotLabel } else { '' }
$archivePath = Join-Path $artifactDirectory ('BrowserCore_{0}_{1}{2}_Source.zip' -f $appVersion.display, $Stage, $recordSuffix)
if (Test-Path -LiteralPath $archivePath) { throw 'Archive already exists; preserve it or choose a new revision before exporting' }
# Use the reviewed publication manifest for every export. Local agent/session
# journals and raw measurements must never slip into a shared source archive.
Push-Location -LiteralPath $projectRoot
try {
    & node scripts/build-github-inventory.mjs --check
    if ($LASTEXITCODE -ne 0) { throw 'Regenerate the project source inventory before export' }
} finally { Pop-Location }
$publication = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/GITHUB_DOSYA_LISTESI.json') -Raw | ConvertFrom-Json
if ($publication.version -ne $appVersion.display -or $publication.reviewFlaggedFiles -ne 0) { throw 'Source review mismatch' }
$publicationEntries = @($publication.files) + @([PSCustomObject]@{path='docs/GITHUB_DOSYA_LISTESI.json';sha256=$null})
$sources = @()
foreach ($entry in $publicationEntries) {
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $projectRoot $entry.path))
    if (-not $sourcePath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source outside project' }
    if ($entry.sha256 -and (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Reviewed source changed' }
    $sources += Get-Item -LiteralPath $sourcePath
}
$records = foreach ($source in $sources) {
    if ($source.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked source file not allowed' }
    if (-not $source.FullName.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source outside project' }
    $entryName = $source.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
    [PSCustomObject]@{ File=$source.FullName; Entry=$entryName; Hash=(Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($record in $records) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $record.File, $record.Entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    $manifest = $archive.CreateEntry('SOURCE_MANIFEST.sha256')
    $writer = [IO.StreamWriter]::new($manifest.Open(), [Text.UTF8Encoding]::new($false))
    try { foreach ($record in ($records | Sort-Object Entry)) { $writer.WriteLine($record.Hash + '  ' + $record.Entry) } } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $records.Count + 1) { throw 'Archive entry count differs' }
    foreach ($record in $records) {
        $entry = $archive.GetEntry($record.Entry)
        if (-not $entry) { throw 'Missing archive entry' }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -ne $record.Hash) { throw 'Archive content hash differs' }
    }
} finally { $archive.Dispose() }
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($archivePath + '.sha256', $archiveHash + '  ' + [IO.Path]::GetFileName($archivePath) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output "SOURCE_ZIP_VERIFIED files=$($records.Count) archive=$archivePath"
Write-Output "SHA256=$archiveHash"
