#!/usr/bin/env bash
#
# smoke.sh — batch smoke test of a built image against a loopback provider fixture, on a Linux
# Docker host that can run the inner OS sandbox (see ../README.md, "Host requirements").
#
# Usage: docker/robota/smoke/smoke.sh <image> [apparmor-profile]
#   apparmor-profile defaults to robota-userns; pass `unconfined` on a host without AppArmor.
#
# Checks, each in a fresh container on an internal network (no route beyond the fixture):
#   1. with all security options: restricted mode, doctor, a normal prompt and /help complete, and the Bash
#      command the fixture asks for runs confined (own PID namespace, no secrets, no network,
#      writes only in the workspace);
#   2. without systempaths=unconfined: startup refuses (sandbox.failIfUnavailable);
#   3. with Docker's default security options: startup refuses;
#   4. an untrusted workspace: a print-mode prompt fails closed;
#   5. the fixture credential appears in no output, container configuration or image history;
#   6. the compose `server` profile's shape: `--serve` behind a proxy sharing its network namespace,
#      the bearer from the secret that profile names, reached by a client only through the proxy.
#
set -euo pipefail

IMAGE="${1:?usage: smoke.sh <image> [apparmor-profile]}"
APPARMOR="${2:-robota-userns}"
SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
SECCOMP="$SMOKE_DIR/../seccomp-bwrap.json"
ID="robota-smoke-$$"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/robota-smoke.XXXXXX")"
KEY="fixture-key-$ID-$RANDOM$RANDOM"
TOKEN="http-token-$ID-$RANDOM$RANDOM$RANDOM$RANDOM"
# The bearer's secret name as the compose `server` profile delivers it, so a profile that passes it
# under a name the CLI ignores fails here.
TOKEN_NAME="$(sed -n 's/^ *target: *\([A-Z_]*HTTP_TOKEN\) *$/\1/p' "$SMOKE_DIR/../compose.yaml")"
[ -n "$TOKEN_NAME" ] || { echo "FAIL  compose.yaml names no HTTP token secret"; exit 1; }
# The proxy the compose `server` profile runs, pinned like the rest of the release inputs.
PROXY_IMAGE='caddy@sha256:4e2425f6009577e7c651010f16679c28f7d12df3e7b1914f941a7a3370746b3c'
FAILED=0

cleanup() {
  docker rm -f -v "$ID-fixture" "$ID-server" "$ID-proxy" >/dev/null 2>&1 || true
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
printf '%s' "$TOKEN" >"$WORK/secrets/$TOKEN_NAME"
chmod 0755 "$WORK/secrets"
chmod 0644 "$WORK/secrets/OPENAI_API_KEY" "$WORK/secrets/$TOKEN_NAME"

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
  robota doctor || true
  robota --restricted-workspace -p "Reply with the smoke word." --output-format json
  robota --restricted-workspace -p /help --output-format json
'
robota_container no-systempaths no-systempaths sh -c '
  git init -q /workspace/repo && cd /workspace/repo && robota --restricted-workspace -p "hello" --output-format json'
robota_container docker-default docker-default sh -c '
  git init -q /workspace/repo && cd /workspace/repo && robota --restricted-workspace -p "hello" --output-format json'
robota_container untrusted full sh -c '
  git init -q /workspace/repo && cd /workspace/repo && robota -p "hello" --output-format json'
# The server profile's shape: the HTTP API on loopback inside the server container, a proxy in its
# network namespace on :8080, and a client container that can reach only the proxy.
docker create --name "$ID-server" --network "$ID" --network-alias server -v "$ID-state:/home/node/.robota" \
  --cap-drop ALL --security-opt no-new-privileges:true --security-opt "seccomp=$SECCOMP" \
  --security-opt "apparmor=$APPARMOR" --security-opt systempaths=unconfined "$IMAGE" sh -c '
    set -eu; git init -q /workspace/repo; cd /workspace/repo
    exec robota --restricted-workspace --serve --http-port 8787' >/dev/null
docker cp "$WORK/secrets" "$ID-server:/run/secrets"
docker start "$ID-server" >/dev/null
docker run -d --name "$ID-proxy" --network "container:$ID-server" --cap-drop ALL --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges:true "$PROXY_IMAGE" caddy reverse-proxy --from :8080 --to 127.0.0.1:8787 >/dev/null
docker run --rm --network "$ID" -e SMOKE_TOKEN="$TOKEN" --entrypoint node "$IMAGE" --input-type=module -e '
  const base = "http://server:8080";
  const call = (path, token, init = {}) => fetch(base + path, { ...init,
    headers: { "content-type": "application/json", ...(token && { authorization: "Bearer " + token }) } });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    ready = await call("/messages").then((r) => r.status === 401, () => false);
    if (!ready) await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("server ready", ready);
  console.log("no token", (await call("/messages")).status);
  console.log("wrong token", (await call("/messages", "wrong-" + process.env.SMOKE_TOKEN)).status);
  const stream = await (await call("/submit", process.env.SMOKE_TOKEN,
    { method: "POST", body: JSON.stringify({ prompt: "Reply with the smoke word." }) })).text();
  console.log("submit complete", /^event: complete$/m.test(stream), "answer", stream.includes("SMOKE_OK"));
  const messages = await (await call("/messages", process.env.SMOKE_TOKEN)).text();
  console.log("messages turn", messages.includes("Reply with the smoke word.") && messages.includes("SMOKE_OK"));
  console.log("direct port", await fetch("http://server:8787/messages").then(() => "reachable", () => "closed"));
' >"$WORK/server-client.out" 2>&1 || true
docker logs "$ID-server" >"$WORK/server.out" 2>&1
echo "----- server"
cat "$WORK/server-client.out"

docker history --no-trunc "$IMAGE" >"$WORK/history"
docker logs "$ID-fixture" >"$WORK/fixture.log" 2>&1

echo "----- results"
check "provider configured" grep -qx 0 "$WORK/configure.status"
check "batch run exits 0" grep -qx 0 "$WORK/batch.status"
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
check "untrusted workspace: trust admission refused" grep -q 'Workspace trust is required before headless startup' "$WORK/untrusted.out"
check "server: answers through the proxy" grep -q 'server ready true' "$WORK/server-client.out"
check "server: no token refused" grep -q 'no token 401' "$WORK/server-client.out"
check "server: wrong token refused" grep -q 'wrong token 401' "$WORK/server-client.out"
check "server: /submit streams to complete with the fixture answer" grep -q 'submit complete true answer true' "$WORK/server-client.out"
check "server: the turn is in /messages" grep -q 'messages turn true' "$WORK/server-client.out"
check "server: reachable only through the proxy" grep -q 'direct port closed' "$WORK/server-client.out"
check "server: token and provider key absent from the server log" \
  bash -c '! grep -qF -e "$1" -e "$2" "$3"' _ "$TOKEN" "$KEY" "$WORK/server.out"
check "credential absent from outputs, container configuration, image history and fixture log" \
  bash -c '! grep -rqF -- "$1" "$2"/*.out "$2"/*.inspect "$2"/history "$2"/fixture.log' _ "$KEY" "$WORK"
# Known gap, reported rather than counted: the shell tool hands confined commands the CLI's own
# environment, so a credential the CLI reads through `$ENV:NAME` is visible to them (README,
# "Credentials").
if grep -q 'OPENAI_API_KEY: visible to commands' "$WORK/batch.out"; then
  echo "GAP   confined command: the provider credential is in its environment"
fi
exit "$FAILED"
