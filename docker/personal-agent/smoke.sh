#!/bin/sh
# Smoke test of the personal agent image against a loopback provider fixture: a turn over the HTTP
# API, the web UI's access-code page, the browser the agent acts through, and owner-only state.
# Usage: docker/personal-agent/smoke.sh [image]   (default personal-agent:local; Linux, host network)
set -eu

image="${1:-personal-agent:local}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
port="${SMOKE_PROVIDER_PORT:-18490}"
name="personal-agent-smoke-$$"
log="$(mktemp)"
fixture_log="$(mktemp)"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  [ -n "${fixture_pid:-}" ] && kill "$fixture_pid" 2>/dev/null || true
  rm -f "$log" "$fixture_log"
}
trap cleanup EXIT

PORT="$port" FIXTURE_TEXT=PERSONAL_SMOKE_OK node "$root/docker/robota/smoke/provider-fixture.mjs" >"$fixture_log" 2>&1 &
fixture_pid=$!

docker run -d --name "$name" --network host \
  -e PERSONAL_AGENT_PROVIDER=openai -e PERSONAL_AGENT_MODEL=smoke-model \
  -e PERSONAL_AGENT_BASE_URL="http://127.0.0.1:$port/v1" \
  -e PERSONAL_AGENT_API_KEY_ENV=SMOKE_KEY -e SMOKE_KEY=smoke-secret-key \
  --cap-drop ALL --security-opt no-new-privileges:true --read-only --tmpfs /tmp \
  "$image" >/dev/null

for _ in $(seq 1 60); do
  docker logs "$name" >"$log" 2>&1
  grep -q 'HTTP API at' "$log" && break
  sleep 1
done
grep -q 'HTTP API at' "$log" || { echo "FAIL: the agent did not start"; cat "$log"; exit 1; }

http_url="$(grep -o 'HTTP API at [^ ]*' "$log" | awk '{print $4}')"
token="$(grep -o 'once): .*' "$log" | cut -d' ' -f2)"
gui_url="$(grep -o 'open at [^ ]*' "$log" | awk '{print $3}')"

reply="$(curl -sS -N -X POST -H "authorization: Bearer $token" -H 'content-type: application/json' \
  -d '{"prompt":"Say hello"}' "$http_url/submit")"
echo "$reply" | grep -q '"response":"PERSONAL_SMOKE_OK"' || { echo "FAIL: no completed turn"; echo "$reply" | tail -5; exit 1; }
echo "ok: a turn completed over the HTTP API"

[ "$(curl -s -o /dev/null -w '%{http_code}' "$http_url/submit" -X POST)" = 401 ] || { echo "FAIL: the HTTP API admitted a request without the bearer"; exit 1; }
echo "ok: the HTTP API refuses a request without the bearer"

curl -sS "$gui_url" | grep -q 'name="code"' || { echo "FAIL: no access-code page"; exit 1; }
echo "ok: the web UI asks for the access code"

# Launched the way the agent launches it: Playwright, the image's Chromium, a profile in the state.
docker exec -w /opt/personal-agent "$name" node -e '
const { chromium } = require("playwright");
(async () => {
  const context = await chromium.launchPersistentContext("/home/node/.personal/smoke-profile", {
    headless: true,
    executablePath: process.env.PERSONAL_AGENT_CHROMIUM,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setContent("<p>browser-ok</p>");
  console.log(await page.textContent("p"));
  await context.close();
})().catch((error) => { console.error(error.message); process.exit(1); });
' | grep -q browser-ok || { echo "FAIL: the browser does not run in the image"; exit 1; }
echo "ok: the agent's browser runs in the image"

[ "$(docker exec "$name" stat -c '%a %U' /home/node/.personal)" = "700 node" ] || { echo "FAIL: state is not owner-only"; exit 1; }
if docker exec "$name" grep -rq smoke-secret-key /home/node/.personal; then echo "FAIL: the provider key was written to state"; exit 1; fi
if grep -q smoke-secret-key "$log"; then echo "FAIL: the provider key reached the log"; exit 1; fi
echo "ok: state is owner-only and holds no provider key"

echo "PASS"
