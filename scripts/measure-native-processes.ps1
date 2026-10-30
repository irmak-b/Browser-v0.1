param(
 [Parameter(Mandatory)][int]$RootPid,
 [Parameter(Mandatory)][string]$Executable,
 [Parameter(Mandatory)][string]$OutputPath,
 [Parameter(Mandatory)][string]$GatePath
)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Preserve existing output'}
if(Test-Path -LiteralPath $GatePath){throw 'Fresh gate required'}
$taskExe=(Resolve-Path -LiteralPath $Executable).Path
$taskWorkspace=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if(-not $taskExe.StartsWith((Join-Path $taskWorkspace 'artifacts')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use owned packaged runtime only'}
$taskReport=[ordered]@{completed=$false;rootPid=$RootPid;method='Normal EXE, no inspector/profiler. Exact executable path and root descendants only. Process CPU seconds and private committed MiB,1s samples for12s. UI reload is requested immediately after gate. Working sets can double-count shared pages. Foreground/quality verified separately; no URL, commandline, environment or profile reads.';samples=@()}
function Save-TaskReport { $taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath }
function Read-TaskProcesses {
 $taskRows=@(Get-CimInstance Win32_Process -Filter "Name='BrowserCore.exe'" | Where-Object ExecutablePath -EQ $taskExe)
 if($RootPid -notin $taskRows.ProcessId){throw 'Owned root no longer exists'}
 $taskIds=[Collections.Generic.HashSet[int]]::new();[void]$taskIds.Add($RootPid)
 do {$taskAdded=$false;foreach($taskRow in $taskRows){if($taskIds.Contains([int]$taskRow.ParentProcessId)-and$taskIds.Add([int]$taskRow.ProcessId)){$taskAdded=$true}}}while($taskAdded)
 $taskResult=@();foreach($taskId in $taskIds){try{$taskProcess=Get-Process -Id $taskId -ErrorAction Stop;$taskResult+=[pscustomobject][ordered]@{pid=$taskId;role=$(if($taskId-eq$RootPid){'main'}else{'child'});cpuSeconds=$taskProcess.TotalProcessorTime.TotalSeconds;privateMiB=$taskProcess.PrivateMemorySize64/1MB;workingSetMiB=$taskProcess.WorkingSet64/1MB}}catch{if($taskId-eq$RootPid){throw}}}
 return ,$taskResult
}
try{
 $null=Read-TaskProcesses;Write-Output 'NATIVE_RESOURCE_GATE_READY'
 $taskDeadline=[DateTime]::UtcNow.AddSeconds(60)
 while(-not(Test-Path -LiteralPath $GatePath)){if([DateTime]::UtcNow-gt$taskDeadline){throw 'Gate timeout'};Start-Sleep -Milliseconds 100}
 $taskClock=[Diagnostics.Stopwatch]::StartNew()
 for($taskIndex=0;$taskIndex-le12;$taskIndex++){
   $taskRemaining=$taskIndex*1000-$taskClock.Elapsed.TotalMilliseconds;if($taskRemaining-gt0){Start-Sleep -Milliseconds ([int]$taskRemaining)}
   $taskRows=Read-TaskProcesses
   $taskReport.samples+=,[pscustomobject][ordered]@{elapsedMs=$taskClock.Elapsed.TotalMilliseconds;processes=$taskRows;privateMiB=($taskRows|Measure-Object privateMiB -Sum).Sum;workingSetMiB=($taskRows|Measure-Object workingSetMiB -Sum).Sum}
   Save-TaskReport
 }
 $taskFirst=$taskReport.samples[0];$taskLast=$taskReport.samples[-1];$taskStart=@{};$taskMax=@{}
 foreach($taskProcess in $taskFirst.processes){$taskStart[$taskProcess.pid]=$taskProcess.cpuSeconds}
 $taskStable=$true;foreach($taskSample in $taskReport.samples){if($taskSample.processes.Count-ne$taskStart.Count){$taskStable=$false};foreach($taskProcess in $taskSample.processes){if(-not$taskStart.ContainsKey($taskProcess.pid)){$taskStable=$false};$taskMax[$taskProcess.pid]=$taskProcess.cpuSeconds}}
 $taskCpu=0.0;foreach($taskPidValue in $taskMax.Keys){$taskCpu+=$taskMax[$taskPidValue]-$(if($taskStart.ContainsKey($taskPidValue)){$taskStart[$taskPidValue]}else{0})}
 $taskReport.completed=$true;$taskReport.processSetStable=$taskStable;$taskReport.cpuSeconds=$taskCpu;$taskReport.wallSeconds=($taskLast.elapsedMs-$taskFirst.elapsedMs)/1000;$taskReport.baselinePrivateMiB=$taskFirst.privateMiB;$taskReport.finalPrivateMiB=$taskLast.privateMiB;$taskReport.peakPrivateMiB=($taskReport.samples|Select-Object -Skip 1|Measure-Object privateMiB -Maximum).Maximum
 Save-TaskReport
 Write-Output ([pscustomobject]$taskReport|Select-Object completed,cpuSeconds,wallSeconds,baselinePrivateMiB,finalPrivateMiB,peakPrivateMiB,processSetStable|ConvertTo-Json -Compress)
}catch{$taskReport.failure=$_.Exception.GetType().Name;Save-TaskReport;throw}
