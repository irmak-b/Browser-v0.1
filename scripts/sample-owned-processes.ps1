param([Parameter(Mandatory)][int]$RootPid,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$OutputPath,[Parameter(Mandatory)][string]$Stage)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskExe=(Resolve-Path -LiteralPath $Executable).Path
$taskOutput=[IO.Path]::GetFullPath((Join-Path $taskRoot $OutputPath))
if(-not $taskExe.StartsWith((Join-Path $taskRoot 'artifacts')+'\',[StringComparison]::OrdinalIgnoreCase)-or-not $taskOutput.StartsWith((Join-Path $taskRoot 'docs/evidence')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Owned package and workspace evidence only'}
$report=if(Test-Path -LiteralPath $taskOutput){Get-Content -LiteralPath $taskOutput -Raw|ConvertFrom-Json}else{[pscustomobject]@{rootPid=$RootPid;method='Exact owned executable and root descendant graph; native CPU seconds/private committed MiB/working set. Stage snapshots only, no process commandlines/environment/profile reads. Working sets can double-count shared pages. No physical-memory or fixed-duration CPU benchmark claim.';samples=@()}}
if($report.rootPid-ne$RootPid-or@($report.samples|Where-Object stage -EQ $Stage).Count){throw 'New stage and same owned root required'}
$rows=@(Get-CimInstance Win32_Process -Filter "Name='BrowserCore.exe'"|Where-Object ExecutablePath -EQ $taskExe)
if($RootPid-notin$rows.ProcessId){throw 'Owned root closed'}
$ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add($RootPid)
do{$added=$false;foreach($row in $rows){if($ids.Contains([int]$row.ParentProcessId)-and$ids.Add([int]$row.ProcessId)){$added=$true}}}while($added)
$processes=@();foreach($id in $ids){try{$p=Get-Process -Id $id -ErrorAction Stop;$processes+=[pscustomobject]@{pid=$id;main=$id-eq$RootPid;cpuSeconds=$p.TotalProcessorTime.TotalSeconds;privateMiB=$p.PrivateMemorySize64/1MB;workingSetMiB=$p.WorkingSet64/1MB}}catch{if($id-eq$RootPid){throw}}}
$sample=[pscustomobject]@{stage=$Stage;atUtc=[DateTime]::UtcNow.ToString('o');privateMiB=($processes|Measure-Object privateMiB -Sum).Sum;workingSetMiB=($processes|Measure-Object workingSetMiB -Sum).Sum;processCount=$processes.Count;processes=$processes}
$report.samples+=,$sample
$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $taskOutput
$sample|Select-Object stage,privateMiB,processCount|ConvertTo-Json -Compress
