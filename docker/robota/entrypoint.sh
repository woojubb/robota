#!/bin/sh
# Image entrypoint: prepare the state directory and credentials, then run the command.
#
# - The image's default user settings (sandbox on, refuse to start when it cannot run) are copied
#   into PRODUCT_USER_STATE_DIR only when no settings.json exists there. A volume mounted over the
#   state directory would otherwise hide a file baked into the image; an operator's own
#   settings.json is never overwritten.
# - Each file in /run/secrets whose name is a valid environment variable name (for example a
#   Docker secret named OPENAI_API_KEY) is exported under that name unless the variable is
#   already set, so a credential can reach `$ENV:NAME` settings without appearing in the
#   container's configuration.
# - Arguments starting with `-` run `robota`; anything else runs as given (for example
#   `sh -c 'git clone … && robota trust --yes && robota -p …'`).
set -eu

state="${PRODUCT_USER_STATE_DIR:?PRODUCT_USER_STATE_DIR must be set}"
if [ ! -e "$state/settings.json" ]; then
  mkdir -p "$state"
  chmod 0700 "$state"
  (umask 077 && cp /usr/local/share/robota/default-settings.json "$state/settings.json")
fi

if [ -d /run/secrets ]; then
  for file in /run/secrets/*; do
    [ -f "$file" ] || continue
    name="${file##*/}"
    case "$name" in
      '' | [0-9]* | *[!A-Za-z0-9_]*) continue ;;
    esac
    if eval "[ -z \"\${$name+set}\" ]"; then
      value="$(cat "$file")"
      export "$name=$value"
    fi
  done
fi

if [ "$#" -eq 0 ] || [ "${1#-}" != "$1" ]; then
  set -- robota "$@"
fi
exec "$@"
