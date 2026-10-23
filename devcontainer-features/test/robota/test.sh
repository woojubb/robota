#!/bin/bash
set -euo pipefail
robota --version | grep -F '3.0.0-beta.96'
test "$PRODUCT_USER_STATE_DIR" = /var/lib/robota/state
test "$(stat -c '%u:%g %a' "$PRODUCT_USER_STATE_DIR")" = "$(id -u):$(id -g) 700"
test -x /usr/local/lib/robota/bin/robota
test ! -e "$PRODUCT_USER_STATE_DIR/settings.json"
test ! -e "$PRODUCT_USER_STATE_DIR/bin/robota"
