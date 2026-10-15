#!/bin/sh
set -eu
if [ "$#" -lt 1 ] || [ ! -s "$1" ]; then echo "Cách dùng: scripts/restore.sh <file-backup.tgz> [volume]" >&2; exit 2; fi
ARCHIVE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
VOLUME="${2:-${EXPENSE_VOLUME:-student-expense-web_expense_data}}"
echo "CẢNH BÁO: khôi phục sẽ ghi đè các file hiện tại trong volume $VOLUME."
printf "Gõ RESTORE để xác nhận: "
read answer
[ "$answer" = "RESTORE" ] || { echo "Đã hủy."; exit 1; }
docker run --rm -v "$VOLUME:/data" -v "$(dirname "$ARCHIVE"):/backup:ro" alpine:3.20 sh -c "find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf '/backup/$(basename "$ARCHIVE")' -C /data"
echo "Khôi phục xong. Khởi động lại container và kiểm tra dữ liệu."
