#!/bin/sh
set -eu
DEST_DIR="${1:-./backups}"
mkdir -p "$DEST_DIR"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
VOLUME="${EXPENSE_VOLUME:-student-expense-web_expense_data}"
OUT="$DEST_DIR/expense-data-$STAMP.tgz"
docker run --rm -v "$VOLUME:/data:ro" -v "$(cd "$DEST_DIR" && pwd):/backup" alpine:3.20 sh -c "tar czf '/backup/$(basename "$OUT")' -C /data ."
test -s "$OUT"
echo "Đã sao lưu volume $VOLUME tại $OUT"
