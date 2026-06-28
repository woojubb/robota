#!/bin/sh
# TEST-007 fake $EDITOR for the /editor PTY scenario.
# Invoked as: sh fake-editor.sh <file>. Reads ONE line from the inherited terminal (proving the
# editor runs on the real TTY under the handoff) and writes it as the file's contents, then exits 0.
file="$1"
IFS= read -r line
printf '%s\n' "$line" > "$file"
