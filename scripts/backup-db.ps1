<#
.SYNOPSIS
  Postgres backup: pg_dump -F c -> dated file -> private Supabase Storage bucket,
  keeping the newest KEEP_DAILY daily + KEEP_WEEKLY weekly copies (locally and in the bucket).
  PowerShell twin of scripts/backup-db.sh; same environment variables:

  BACKUP_DATABASE_URL (required, session pooler :5432; :6543 is switched automatically)
  BACKUP_STORAGE_URL, BACKUP_STORAGE_KEY, BACKUP_BUCKET (default db-backups)   -- for upload
  BACKUP_LABEL (db), BACKUP_SCHEMAS (public), BACKUP_DIR (.\backups), BACKUP_UPLOAD (supabase|none)
  KEEP_DAILY (14), KEEP_WEEKLY (8), WEEKLY_DAY (7 = Sunday, ISO weekday)

  Never prints the connection string, keys or dump contents.
#>
$ErrorActionPreference = 'Stop'

function Get-Env($name, $default) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrEmpty($v)) { return $default } else { return $v }
}

$dbUrl = Get-Env 'BACKUP_DATABASE_URL' $null
if (-not $dbUrl) { throw 'BACKUP_DATABASE_URL is required' }
$dbUrl = $dbUrl -replace 'pooler\.supabase\.com:6543', 'pooler.supabase.com:5432'
$label = Get-Env 'BACKUP_LABEL' 'db'
$schemas = (Get-Env 'BACKUP_SCHEMAS' 'public') -split ','
$dir = Get-Env 'BACKUP_DIR' (Join-Path (Get-Location) 'backups')
$upload = Get-Env 'BACKUP_UPLOAD' 'supabase'
$bucket = Get-Env 'BACKUP_BUCKET' 'db-backups'
$keepDaily = [int](Get-Env 'KEEP_DAILY' 14)
$keepWeekly = [int](Get-Env 'KEEP_WEEKLY' 8)
$weeklyDay = [int](Get-Env 'WEEKLY_DAY' 7)

$now = (Get-Date).ToUniversalTime()
$name = "$label-$($now.ToString('yyyy-MM-dd')).dump"
$dailyDir = Join-Path $dir 'daily'
$weeklyDir = Join-Path $dir 'weekly'
New-Item -ItemType Directory -Force $dailyDir, $weeklyDir | Out-Null
$file = Join-Path $dailyDir $name

$dumpArgs = @('--format=custom', '--compress=9', '--no-owner', '--no-privileges')
foreach ($s in $schemas) { $dumpArgs += "--schema=$($s.Trim())" }
$dumpArgs += @("--file=$file", "--dbname=$dbUrl")

Write-Host "Dumping schemas [$($schemas -join ',')] -> $file"
& pg_dump @dumpArgs
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }
& pg_restore --list $file | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Dump archive is unreadable' }
$size = (Get-Item $file).Length
Write-Host "Dump OK: $name ($size bytes)"

$isoDay = [int]$now.DayOfWeek; if ($isoDay -eq 0) { $isoDay = 7 }
$weeklyFile = Join-Path $weeklyDir $name
if ($isoDay -eq $weeklyDay) {
  Copy-Item $file $weeklyFile -Force
  Write-Host "Weekly copy: weekly/$name"
}

function Remove-OldLocal($folder, $keep) {
  Get-ChildItem $folder -Filter "$label-*.dump" | Sort-Object Name -Descending | Select-Object -Skip $keep |
    ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "Pruned local $($_.Name)" }
}
Remove-OldLocal $dailyDir $keepDaily
Remove-OldLocal $weeklyDir $keepWeekly

if ($upload -eq 'none') { Write-Host 'Upload disabled (BACKUP_UPLOAD=none). Done.'; exit 0 }

$storageUrl = Get-Env 'BACKUP_STORAGE_URL' $null
$key = Get-Env 'BACKUP_STORAGE_KEY' $null
if (-not $storageUrl -or -not $key) { throw 'BACKUP_STORAGE_URL and BACKUP_STORAGE_KEY are required for upload' }
$api = "$($storageUrl.TrimEnd('/'))/storage/v1"
$headers = @{ apikey = $key }
# Legacy JWT service-role keys also go in Authorization; new sb_secret_ keys only in apikey.
if ($key.StartsWith('eyJ')) { $headers['Authorization'] = "Bearer $key" }

if ($size -gt 52428800) {
  Write-Warning 'Dump is over 50 MB, the Supabase free-plan upload limit. Raise the limit or use another store.'
}

try {
  Invoke-RestMethod -Method Post -Uri "$api/bucket" -Headers $headers -ContentType 'application/json' `
    -Body (@{ id = $bucket; name = $bucket; public = $false } | ConvertTo-Json) | Out-Null
  Write-Host "Created private bucket $bucket"
} catch {
  $code = [int]$_.Exception.Response.StatusCode
  if ($code -ne 400 -and $code -ne 409) { throw "Bucket check failed (HTTP $code)" }
}

function Send-Object($src, $dest) {
  $h = $headers.Clone(); $h['x-upsert'] = 'true'
  Invoke-RestMethod -Method Post -Uri "$api/object/$bucket/$dest" -Headers $h `
    -ContentType 'application/octet-stream' -InFile $src | Out-Null
  Write-Host "Uploaded $bucket/$dest"
}
Send-Object $file "daily/$name"
if (Test-Path $weeklyFile) { Send-Object $weeklyFile "weekly/$name" }

function Remove-OldRemote($prefix, $keep) {
  $body = @{ prefix = "$prefix/"; limit = 1000; sortBy = @{ column = 'name'; order = 'desc' } } | ConvertTo-Json
  $items = Invoke-RestMethod -Method Post -Uri "$api/object/list/$bucket" -Headers $headers -ContentType 'application/json' -Body $body
  $names = @($items | ForEach-Object { $_.name } | Where-Object { $_ -like "$label-*.dump" } | Sort-Object -Descending)
  $old = @($names | Select-Object -Skip $keep)
  if ($old.Count -gt 0) {
    $del = @{ prefixes = @($old | ForEach-Object { "$prefix/$_" }) } | ConvertTo-Json
    Invoke-RestMethod -Method Delete -Uri "$api/object/$bucket" -Headers $headers -ContentType 'application/json' -Body $del | Out-Null
    Write-Host "Pruned $($old.Count) old $prefix copies"
  }
  Write-Host "Remote ${prefix}: $($names.Count) before prune, keeping $keep"
}
Remove-OldRemote 'daily' $keepDaily
Remove-OldRemote 'weekly' $keepWeekly
Write-Host 'Backup complete.'
