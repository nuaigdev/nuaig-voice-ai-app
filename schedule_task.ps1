# Registers (or updates) the Windows scheduled task that runs fetch_events.py.
#
# The schedule itself lives in Windows Task Scheduler, not in a file, so this
# script is the single place to edit it: change the settings below and re-run
# it. Running it again overwrites the existing task rather than adding another.
#
#   Run with:   powershell -ExecutionPolicy Bypass -File .\schedule_task.ps1

# ======================= EDIT THESE =======================

$RunTime = "09:00"          # when to run, 24-hour HH:mm   (e.g. "07:00", "22:30")

$RunTimeZone = "Eastern Standard Time"
                            # the zone $RunTime is written in. Seabury is in
                            # Eastern, so the events refresh is pinned to 09:00
                            # there whatever this machine's clock says. The id
                            # covers both EST and EDT. Set to "" to mean this
                            # machine's own local time and skip conversion.

$Repeat = "Weekly"          # "Weekly" = once a week, on $DayOfWeek
                            # "Daily"  = every day at $RunTime
                            # "Once"   = one run only, at $RunTime today

$DayOfWeek = "Monday"       # only used when $Repeat = "Weekly"

$RunAsSystem = $false       # $false = runs only while you are logged on
                            # $true  = runs unattended (needed on the VM)

# ==========================================================

$TaskName = "NuVA Catie Events Fetch"
$Wrapper = Join-Path $PSScriptRoot "fetch_events_task.cmd"

if (-not (Test-Path $Wrapper)) {
    Write-Error "Cannot find $Wrapper"
    exit 1
}

# Validate the time early, so a typo fails here instead of silently never firing.
try {
    $parsed = [datetime]::ParseExact($RunTime, "HH:mm", $null)
} catch {
    Write-Error "RunTime must be 24-hour HH:mm, for example 06:00 or 13:19. Got '$RunTime'."
    exit 1
}

$valid = @("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
if ($Repeat -eq "Weekly" -and $valid -notcontains $DayOfWeek) {
    Write-Error "DayOfWeek must be a full day name, e.g. Monday. Got '$DayOfWeek'."
    exit 1
}

# Task Scheduler fires on this machine's clock and only applies DST for this
# machine's zone, so a $RunTime written in another zone is converted here. The
# conversion holds for the offset in force on the next run; see the DST note
# printed at the end.
$here = [System.TimeZoneInfo]::Local
$runAt = $parsed
$runDay = $DayOfWeek
$zoneNote = "$RunTime $($here.Id) (this machine)"
$dstNote = $null

if ($RunTimeZone -ne "") {
    try {
        $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($RunTimeZone)
    } catch {
        Write-Error "RunTimeZone '$RunTimeZone' is not a Windows time zone id. List them with: Get-TimeZone -ListAvailable | Select-Object Id"
        exit 1
    }

    if ($tz.Id -eq $here.Id) {
        # Same zone: let Task Scheduler handle DST natively, which is what the VM should do.
        $zoneNote = "$RunTime $($tz.Id) (this machine's own zone, DST handled by Windows)"
    } else {
        # Take the next date that matches the requested weekday, read in the target
        # zone, and convert that instant to this machine's clock.
        $target = (Get-Date).Date.AddHours($parsed.Hour).AddMinutes($parsed.Minute)
        if ($Repeat -eq "Weekly") {
            while ($target.DayOfWeek -ne [System.DayOfWeek]$DayOfWeek) { $target = $target.AddDays(1) }
        }
        $unspec = [datetime]::SpecifyKind($target, [System.DateTimeKind]::Unspecified)
        $utc = [System.TimeZoneInfo]::ConvertTimeToUtc($unspec, $tz)
        $runAt = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $here)

        # Converting can cross midnight, which moves the weekday the trigger needs.
        if ($Repeat -eq "Weekly") { $runDay = [string]$runAt.DayOfWeek }

        $abbrev = if ($tz.IsDaylightSavingTime($unspec)) { "daylight" } else { "standard" }
        $zoneNote = "$RunTime $($tz.Id) ($abbrev time) = $($runAt.ToString('HH:mm')) $($here.Id)"

        # When the target zone changes offset, this fixed local time drifts by an
        # hour. Report the date so the re-run is not a surprise.
        $baseOffset = $tz.GetUtcOffset($unspec)
        for ($i = 1; $i -le 400; $i++) {
            $probe = $unspec.AddDays($i)
            if ($tz.GetUtcOffset($probe) -ne $baseOffset) {
                $shifted = $runAt.AddHours(($baseOffset - $tz.GetUtcOffset($probe)).TotalHours)
                $dstNote = "$($tz.Id) changes offset on $($probe.ToString('yyyy-MM-dd')). After that this task fires at $($shifted.ToString('HH:mm')) $($here.Id), i.e. one hour off $RunTime there. Re-run this script on or after that date to correct it."
                break
            }
        }
    }
}

$action = New-ScheduledTaskAction -Execute $Wrapper

if ($Repeat -eq "Weekly") {
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $runDay -At $runAt
} elseif ($Repeat -eq "Daily") {
    $trigger = New-ScheduledTaskTrigger -Daily -At $runAt
} elseif ($Repeat -eq "Once") {
    $trigger = New-ScheduledTaskTrigger -Once -At $runAt
} else {
    Write-Error "Repeat must be 'Weekly', 'Daily' or 'Once'. Got '$Repeat'."
    exit 1
}

$register = @{
    TaskName    = $TaskName
    Action      = $action
    Trigger     = $trigger
    Description = "Fetches the next 7 days of Catie events to events_<date>.txt and uploads them to the RETELL_KB_EVENTS knowledge base. Scheduled for $RunTime $RunTimeZone."
    Force       = $true
}

if ($RunAsSystem) {
    $register.Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
        -LogonType ServiceAccount -RunLevel Limited
}

Register-ScheduledTask @register | Out-Null

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ""
Write-Host "Task      : $TaskName"
Write-Host "Runs      : $Wrapper"
if ($Repeat -eq "Weekly") {
    Write-Host "Schedule  : every $DayOfWeek at $zoneNote"
    if ($runDay -ne $DayOfWeek) {
        Write-Host "            (fires $runDay on this machine, because the conversion crosses midnight)"
    }
} else {
    Write-Host "Schedule  : $Repeat at $zoneNote"
}
Write-Host "Account   : $(if ($RunAsSystem) { 'SYSTEM (unattended)' } else { "$env:USERNAME (only while logged on)" })"
Write-Host "Next run  : $($info.NextRunTime)"
if ($dstNote) {
    Write-Host ""
    Write-Host "DST note  : $dstNote"
}
Write-Host ""
Write-Host "Check results with:"
Write-Host "  Get-ScheduledTaskInfo -TaskName `"$TaskName`" | Select-Object LastRunTime, LastTaskResult, NextRunTime"
Write-Host "  Get-Content `"$(Join-Path $PSScriptRoot 'fetch_events.log')`" -Tail 20"
