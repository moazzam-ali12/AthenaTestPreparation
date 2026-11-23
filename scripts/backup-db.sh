#!/usr/bin/env bash
# Nightly Postgres backup: pg_dump -F c -> dated file -> private Supabase Storage bucket,
# keeping the newest KEEP_DAILY daily + KEEP_WEEKLY weekly copies (locally and in the bucket).
#
# Required env:
#   BACKUP_DATABASE_URL   postgres URL of the project to back up. Use the SESSION pooler
#                         (port 5432); a transaction-pooler URL (:6543) is switched to :5432.
# Upload (BACKUP_UPLOAD=supabase, the default):
#   BACKUP_STORAGE_URL    https://<ref>.supabase.co of the project that stores the backups
#   BACKUP_STORAGE_KEY    service-role / secret key of that project
#   BACKUP_BUCKET         private bucket name (default: db-backups; created if missing)
# Optional:
#   BACKUP_LABEL          file prefix, e.g. prod / staging (default: db)
#   BACKUP_SCHEMAS        comma-separated schemas to dump (default: public)
#   BACKUP_DIR            local folder (default: ./backups)
#   BACKUP_UPLOAD         supabase | none   (none = keep local copies only)
#   KEEP_DAILY=14  KEEP_WEEKLY=8  WEEKLY_DAY=7 (ISO weekday that also gets a weekly copy; 7 = Sunday)
#
# Never prints the connection string, keys or dump contents — only names, sizes and counts.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
LABEL="${BACKUP_LABEL:-db}"
SCHEMAS="${BACKUP_SCHEMAS:-public}"
DIR="${BACKUP_DIR:-./backups}"
UPLOAD="${BACKUP_UPLOAD:-supabase}"
BUCKET="${BACKUP_BUCKET:-db-backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
WEEKLY_DAY="${WEEKLY_DAY:-7}"
PY="$(command -v python3 || command -v python)"

DB_URL="${BACKUP_DATABASE_URL/pooler.supabase.com:6543/pooler.supabase.com:5432}"
DATE="$(date -u +%Y-%m-%d)"
NAME="${LABEL}-${DATE}.dump"
mkdir -p "$DIR/daily" "$DIR/weekly"
FILE="$DIR/daily/$NAME"

schema_args=()
IFS=',' read -ra _schemas <<< "$SCHEMAS"
for s in "${_schemas[@]}"; do schema_args+=(--schema="$s"); done

echo "Dumping schemas [$SCHEMAS] -> $FILE"
pg_dump --format=custom --compress=9 --no-owner --no-privileges "${schema_args[@]}" \
  --file="$FILE" --dbname="$DB_URL"
pg_restore --list "$FILE" > /dev/null # fails if the archive is unreadable
SIZE=$(wc -c < "$FILE" | tr -d ' ')
echo "Dump OK: $NAME ($SIZE bytes)"

if [ "$(date -u +%u)" = "$WEEKLY_DAY" ]; then
  cp "$FILE" "$DIR/weekly/$NAME"
  echo "Weekly copy: weekly/$NAME"
fi

# Local retention: newest N files per folder (names sort by date).
prune_local() {
  local folder="$1" keep="$2"
  # `|| true`: grep exits 1 on an empty folder, which pipefail + set -e would turn into a silent exit.
  { ls -1 "$folder" 2>/dev/null | grep "^${LABEL}-.*\.dump$" || true; } | sort -r | tail -n +"$((keep + 1))" |
    while read -r f; do rm -f "$folder/$f"; echo "Pruned local $folder/$f"; done
}
prune_local "$DIR/daily" "$KEEP_DAILY"
prune_local "$DIR/weekly" "$KEEP_WEEKLY"

if [ "$UPLOAD" = "none" ]; then
  echo "Upload disabled (BACKUP_UPLOAD=none). Done."
  exit 0
fi

: "${BACKUP_STORAGE_URL:?BACKUP_STORAGE_URL is required for upload}"
: "${BACKUP_STORAGE_KEY:?BACKUP_STORAGE_KEY is required for upload}"
API="${BACKUP_STORAGE_URL%/}/storage/v1"
auth=(-H "apikey: $BACKUP_STORAGE_KEY")
# Legacy JWT service-role keys also go in Authorization; new sb_secret_ keys only in apikey.
case "$BACKUP_STORAGE_KEY" in eyJ*) auth+=(-H "Authorization: Bearer $BACKUP_STORAGE_KEY") ;; esac

if [ "$SIZE" -gt 52428800 ]; then
  echo "WARNING: dump is over 50 MB, the Supabase free-plan upload limit. Raise the limit or use another store." >&2
fi

# Create the private bucket if it does not exist (409/400 = already exists).
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/bucket" "${auth[@]}" \
  -H 'Content-Type: application/json' -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":false}")
case "$code" in 200|201|400|409) ;; *) echo "Bucket check failed (HTTP $code)" >&2; exit 1 ;; esac

upload() {
  local src="$1" dest="$2" code
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/object/$BUCKET/$dest" "${auth[@]}" \
    -H 'x-upsert: true' -H 'Content-Type: application/octet-stream' --data-binary "@$src")
  [ "$code" = "200" ] || { echo "Upload of $dest failed (HTTP $code)" >&2; exit 1; }
  echo "Uploaded $BUCKET/$dest"
}
upload "$FILE" "daily/$NAME"
[ -f "$DIR/weekly/$NAME" ] && upload "$DIR/weekly/$NAME" "weekly/$NAME"

prune_remote() {
  local prefix="$1" keep="$2" names
  names=$(curl -sS -X POST "$API/object/list/$BUCKET" "${auth[@]}" -H 'Content-Type: application/json' \
    -d "{\"prefix\":\"$prefix/\",\"limit\":1000,\"sortBy\":{\"column\":\"name\",\"order\":\"desc\"}}" |
    "$PY" -c "import json,sys; print('\n'.join(sorted((o['name'] for o in json.load(sys.stdin) if o['name'].startswith('$LABEL-') and o['name'].endswith('.dump')), reverse=True)))")
  local old
  old=$(printf '%s\n' "$names" | sed '/^$/d' | tail -n +"$((keep + 1))")
  local count
  count=$(printf '%s\n' "$names" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ -n "$old" ]; then
    local body
    body=$(printf '%s\n' "$old" | "$PY" -c "import json,sys; print(json.dumps({'prefixes':['$prefix/'+l.strip() for l in sys.stdin if l.strip()]}))")
    curl -sS -o /dev/null -X DELETE "$API/object/$BUCKET" "${auth[@]}" -H 'Content-Type: application/json' -d "$body"
    echo "Pruned $(printf '%s\n' "$old" | wc -l | tr -d ' ') old $prefix copies"
  fi
  echo "Remote $prefix: $count before prune, keeping $keep"
}
prune_remote daily "$KEEP_DAILY"
prune_remote weekly "$KEEP_WEEKLY"
echo "Backup complete."
