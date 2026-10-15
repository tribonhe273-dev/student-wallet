#!/bin/sh
set -eu

# When no production secret is supplied, create one once and persist it in
# the named /data volume. This keeps Flask sessions valid across restarts.
placeholder='replace-with-a-random-secret-of-at-least-32-characters'
if [ -z "${SECRET_KEY:-}" ] || [ "${SECRET_KEY:-}" = "$placeholder" ]; then
    secret_file="${SECRET_KEY_FILE:-/data/.secret_key}"
    secret_dir=$(dirname "$secret_file")

    if ! mkdir -p "$secret_dir"; then
        echo '[ERROR] Cannot create directory for SECRET_KEY_FILE.' >&2
        exit 1
    fi

    if [ ! -s "$secret_file" ]; then
        temp_file="${secret_file}.tmp.$$"
        umask 077
        if ! python -c 'import secrets,sys; open(sys.argv[1], "x").write(secrets.token_urlsafe(48) + "\n")' "$temp_file"; then
            echo '[ERROR] Cannot generate a secure SECRET_KEY.' >&2
            rm -f "$temp_file"
            exit 1
        fi
        chmod 600 "$temp_file"
        # Atomic rename prevents the application from seeing a partial key.
        if ! mv -f "$temp_file" "$secret_file"; then
            rm -f "$temp_file"
            echo '[ERROR] Cannot persist SECRET_KEY. Check /data permissions.' >&2
            exit 1
        fi
    fi

    SECRET_KEY=$(cat "$secret_file")
    if [ -z "$SECRET_KEY" ]; then
        echo '[ERROR] SECRET_KEY file is empty.' >&2
        exit 1
    fi
    export SECRET_KEY
fi

exec "$@"
