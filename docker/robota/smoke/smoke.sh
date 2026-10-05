#!/usr/bin/env bash
#
# smoke.sh — batch smoke test of a built image against a loopback provider fixture, on a Linux
# Docker host that can run the inner OS sandbox (see ../README.md, "Host requirements").
#
# Usage: docker/robota/smoke/smoke.sh <image> [apparmor-profile]
#   apparmor-profile defaults to robota-userns; pass `unconfined` on a host without AppArmor.
#
# Checks, each in a fresh container on an internal network (no route beyond the fixture):
#   1. with all security options: trust, doctor, a normal prompt and /help complete, and the Bash
#      command the fixture asks for runs confined (own PID namespace, no secrets, no network,
#      writes only in the workspace);
#   2. without systempaths=unconfined: startup refuses (sandbox.failIfUnavailable);
#   3. with Docker's default security options: startup refuses;
#   4. an untrusted workspace: a print-mode prompt fails closed;
#   5. the fixture credential appears in no output, container configuration or image history.
#
set -euo pipefail

IMAGE="${1:?usage: smoke.sh <image> [apparmor-profile]}"
APPARMOR="${2:-robota-userns}"
SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
SECCOMP="$SMOKE_DIR/../seccomp-bwrap.json"
ID="robota-smoke-$$"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/robota-smoke.XXXXXX")"
KEY="fixture-key-$ID-$RANDOM$RANDOM"
FAILED=0

cleanup() {
  docker rm -f -v "$ID-fixture" >/dev/null 2>&1 || true
  docker volume rm "$ID-state" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

check() { # check <description> <command...>
  local description="$1"
  shift
  if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; FAILED=1; fi
}

# Run one container: robota_container <name> <security> <command...>; output goes to $WORK/<name>.
robota_container() {
  local name="$1" security="$2"
  shift 2
  local options=(--cap-drop ALL --security-opt no-new-privileges:true)
  case "$security" in
    full) options+=(--security-opt "seccomp=$SECCOMP" --security-opt "apparmor=$APPARMOR" --security-opt systempaths=unconfined) ;;
    no-systempaths) options+=(--security-opt "seccomp=$SECCOMP" --security-opt "apparmor=$APPARMOR") ;;
    docker-default) ;;
  esac
  docker create --name "$ID-$name" --network "$ID" -v "$ID-state:/home/node/.robota" \
    "${options[@]}" "$IMAGE" "$@" >/dev/null
  docker cp "$WORK/secrets" "$ID-$name:/run/secrets"
  local status=0
  docker start -a "$ID-$name" >"$WORK/$name.out" 2>&1 || status=$?
  docker inspect "$ID-$name" >"$WORK/$name.inspect"
  docker rm -v "$ID-$name" >/dev/null
  echo "$status" >"$WORK/$name.status"
  echo "----- $name ($security) exit $status"
  cat "$WORK/$name.out"
}

# The credential reaches the container as a Docker-secret-style file, never as configuration.
mkdir -p "$WORK/secrets"
printf '%s' "$KEY" >"$WORK/secrets/OPENAI_API_KEY"
chmod 0755 "$WORK/secrets"
chmod 0644 "$WORK/secrets/OPENAI_API_KEY"

docker network create --internal "$ID" >/dev/null
docker volume create "$ID-state" >/dev/null
# The command the fixture asks the agent to run; the image runs it inside the OS sandbox.
FIXTURE_COMMAND='echo "pid 1: $(cat /proc/1/comm)"
cat /run/secrets/OPENAI_API_KEY 2>&1 || true
if [ -n "${OPENAI_API_KEY:-}" ]; then echo "OPENAI_API_KEY: visible to commands"; else echo "OPENAI_API_KEY: not in the command environment"; fi
touch /home/node/outside-workspace 2>&1 || true
getent hosts fixture || echo "fixture: unreachable"
touch inside-workspace && echo "workspace: writable"'
docker run -d --name "$ID-fixture" --network "$ID" --network-alias fixture \
  -e FIXTURE_TEXT=SMOKE_OK -e FIXTURE_COMMAND="$FIXTURE_COMMAND" --entrypoint node "$IMAGE" \
  --input-type=module -e "$(cat "$SMOKE_DIR/provider-fixture.mjs")" >/dev/null

robota_container configure full robota --configure-provider fixture --type openai \
  --model fixture-model --base-url http://fixture:8080/v1 --api-key-env OPENAI_API_KEY --set-current

robota_container batch full sh -c '
  set -e
  git init -q /workspace/repo && cd /workspace/repo
  robota trust --yes
  robota doctor || true
  robota -p "Reply with the smoke word." --output-format json
  robota -p /help --output-format json
'
robota_container no-systempaths no-systempaths sh -c '
  git init -q /workspace/repo && cd /workspace/repo && robota trust --yes >/dev/null && robota -p "hello" --output-format json'
robota_container docker-default docker-default sh -c '
  git init -q /workspace/repo && cd /workspace/repo && robota trust --yes >/dev/null && robota -p "hello" --output-format json'
robota_container untrusted full sh -c '
  git init -q /workspace/repo && cd /workspace/repo && robota -p "hello" --output-format json'
docker history --no-trunc "$IMAGE" >"$WORK/history"
docker logs "$ID-fixture" >"$WORK/fixture.log" 2>&1

echo "----- results"
check "provider configured" grep -qx 0 "$WORK/configure.status"
check "batch run exits 0" grep -qx 0 "$WORK/batch.status"
check "trust granted" grep -q 'Workspace trust: trusted' "$WORK/batch.out"
check "sandbox active (doctor)" grep -q 'Command containment \[execution.containment\] ok: sandbox-shared' "$WORK/batch.out"
success() { grep -F -- "$1" "$WORK/batch.out" | grep -q '"subtype":"success"'; }
check "prompt answered by the fixture" success '"result":"SMOKE_OK'
check "/help answered" success '(/help)'
check "confined command: own PID namespace" grep -q 'pid 1: bwrap' "$WORK/batch.out"
check "confined command: /run/secrets hidden" grep -q 'cat: /run/secrets/OPENAI_API_KEY: No such file or directory' "$WORK/batch.out"
check "confined command: write outside the workspace refused" grep -q "touch: cannot touch '/home/node/outside-workspace': Read-only file system" "$WORK/batch.out"
check "confined command: network unreachable" grep -q 'fixture: unreachable' "$WORK/batch.out"
check "confined command: workspace writable" grep -q 'workspace: writable' "$WORK/batch.out"
check "no systempaths: refused" grep -q 'Refusing to start (sandbox.failIfUnavailable)' "$WORK/no-systempaths.out"
check "no systempaths: non-zero exit" grep -qvx 0 "$WORK/no-systempaths.status"
check "docker defaults: refused" grep -q 'Refusing to start (sandbox.failIfUnavailable)' "$WORK/docker-default.out"
check "docker defaults: non-zero exit" grep -qvx 0 "$WORK/docker-default.status"
check "untrusted workspace: non-zero exit" grep -qvx 0 "$WORK/untrusted.status"
check "credential absent from outputs, container configuration, image history and fixture log" \
  bash -c '! grep -rqF -- "$1" "$2"/*.out "$2"/*.inspect "$2"/history "$2"/fixture.log' _ "$KEY" "$WORK"
# Known gap, reported rather than counted: the shell tool hands confined commands the CLI's own
# environment, so a credential the CLI reads through `$ENV:NAME` is visible to them (README,
# "Credentials").
if grep -q 'OPENAI_API_KEY: visible to commands' "$WORK/batch.out"; then
  echo "GAP   confined command: the provider credential is in its environment"
fi
exit "$FAILED"
