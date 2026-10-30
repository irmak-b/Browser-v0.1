param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'app-version.json') -Raw|ConvertFrom-Json).display
if($version -notmatch '^V\d+\.\d+\.\d+\.\d+$'){throw 'Invalid version'}
$target=[IO.Path]::GetFullPath($Destination)
$cache=[IO.Path]::GetFullPath((Join-Path $projectRoot '.cache'))
if(-not $target.StartsWith($cache+'\portable-validation-', [StringComparison]::OrdinalIgnoreCase)){throw 'Test extraction outside managed cache'}
foreach($path in @($cache,$target)){
    if((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked extraction root'}
}
if(@(Get-ChildItem -LiteralPath $target -Force).Count){throw 'Extraction destination must be empty'}
$archivePath=Join-Path $projectRoot ('artifacts/BrowserCore_{0}_Windows_x64.zip' -f $version)
$zipHash=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if(-not (Get-Content -LiteralPath ($archivePath+'.sha256') -Raw).StartsWith($zipHash+'  ')){throw 'ZIP checksum mismatch'}
$zip=[IO.Compression.ZipFile]::OpenRead($archivePath)
try{
    foreach($entry in $zip.Entries){
        $entryPath=[IO.Path]::GetFullPath((Join-Path $target $entry.FullName))
        if(-not $entryPath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'ZIP path outside extraction'}
    }
}finally{$zip.Dispose()}
[IO.Compression.ZipFile]::ExtractToDirectory($archivePath,$target)
$folder=Join-Path $target ('BrowserCore_{0}_Windows_x64' -f $version)
$manifest=@(Get-Content -LiteralPath (Join-Path $folder 'SHA256SUMS.txt'))
if(@(Get-ChildItem -LiteralPath $folder -Recurse -File).Count -ne $manifest.Count+1){throw 'Extracted package has unexpected files'}
foreach($line in $manifest){
    if($line -notmatch '^([a-f0-9]{64})  (.+)$'){throw 'Invalid extracted manifest'}
    $expected=$Matches[1];$relative=$Matches[2]
    $file=[IO.Path]::GetFullPath((Join-Path $folder $relative))
    if(-not $file.StartsWith($folder+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Manifest path outside package'}
    if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Extracted file checksum mismatch'}
}
[ordered]@{directory=$folder;executable=(Join-Path $folder 'BrowserCore.exe');verifiedFiles=$manifest.Count+1;zipHash=$zipHash}|ConvertTo-Json -Compress
