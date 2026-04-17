$BackupDir = "\\ppg_fps\ppg\PPG-Backups"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Filename = "ppg_estimator_$Timestamp.sql.gz"
$RepoDir = "C:\Users\admin\Documents\GitHub\ppg-estimator"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$TempFile = Join-Path $env:TEMP "ppg_backup_$Timestamp.sql"
docker compose -f "$RepoDir\docker-compose.yml" exec -T db pg_dump -U ppg ppg_estimator | Out-File -FilePath $TempFile -Encoding UTF8

$OutPath = Join-Path $BackupDir $Filename
$in = [System.IO.File]::OpenRead($TempFile)
$out = [System.IO.File]::Create($OutPath)
$gzip = New-Object System.IO.Compression.GzipStream($out, [System.IO.Compression.CompressionMode]::Compress)
$in.CopyTo($gzip)
$gzip.Close(); $out.Close(); $in.Close()
Remove-Item $TempFile

Write-Host "Backup created: $OutPath"

Get-ChildItem "$BackupDir\ppg_estimator_*.sql.gz" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item