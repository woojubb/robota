#!/bin/sh
# Installs a self-hosted personal agent on a fresh Ubuntu or Debian server: Docker from the
# distribution, this repository, the domain and provider settings, the provider key in an owner-only
# file, then the agent behind Caddy's HTTPS. Run it as root (or with sudo) on the server:
#
#   curl -fsSLO https://raw.githubusercontent.com/woojubb/robota/main/docker/personal-agent/server/install.sh
#   sudo sh install.sh
#
# Every answer can be given ahead as an environment variable (PERSONAL_AGENT_DOMAIN,
# PERSONAL_AGENT_ACME_EMAIL, PERSONAL_AGENT_PROVIDER, PERSONAL_AGENT_MODEL, PERSONAL_AGENT_BASE_URL,
# PERSONAL_AGENT_API_KEY_ENV, and the key itself under the name PERSONAL_AGENT_API_KEY_ENV gives).
# Before you start, point the domain's DNS A (and AAAA) record at this server and open ports 80 and 443.
set -eu

repo_url="${PERSONAL_AGENT_REPO:-https://github.com/woojubb/robota.git}"
repo_ref="${PERSONAL_AGENT_REF:-main}"
install_dir="${PERSONAL_AGENT_DIR:-/opt/robota}"

say() { printf '%s\n' "$*"; }
fail() { printf 'install: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail 'run this as root, for example: sudo sh install.sh'
command -v apt-get >/dev/null 2>&1 || fail 'this installer supports Ubuntu and Debian (apt-get)'

ask() {
  # ask VAR "Question" [default]: keep a value given in the environment, else read one.
  var="$1"; question="$2"; default="${3:-}"
  eval "current=\${$var:-}"
  if [ -z "$current" ]; then
    if [ -n "$default" ]; then printf '%s [%s]: ' "$question" "$default"; else printf '%s: ' "$question"; fi
    read -r current </dev/tty || true
    [ -n "$current" ] || current="$default"
  fi
  [ -n "$current" ] || fail "$question is required"
  eval "$var=\$current"
}

say '== Installing Docker and git from the distribution'
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io git ca-certificates
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -q docker-compose-v2 2>/dev/null || apt-get install -y -q docker-compose 2>/dev/null || true
fi
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is not available from this distribution; install it, then run this again'
systemctl enable --now docker >/dev/null 2>&1 || true

say "== Getting the personal agent into $install_dir"
if [ -d "$install_dir/.git" ]; then
  git -C "$install_dir" fetch -q origin "$repo_ref"
  git -C "$install_dir" checkout -q --detach FETCH_HEAD
else
  git clone -q --depth 1 --branch "$repo_ref" "$repo_url" "$install_dir"
fi
bundle="$install_dir/docker/personal-agent/server"

say '== Settings'
# An update keeps the answers given last time: the settings file holds only plain NAME=value lines.
if [ -f "$bundle/.env" ]; then
  while IFS='=' read -r name value; do
    case "$name" in
      PERSONAL_AGENT_*[!A-Z_]*) ;;
      PERSONAL_AGENT_*) eval "[ -n \"\${$name:-}\" ] || $name=\$value" ;;
    esac
  done <"$bundle/.env"
fi
ask PERSONAL_AGENT_DOMAIN 'Domain people will open (its DNS must point here)'
ask PERSONAL_AGENT_ACME_EMAIL 'Email for the HTTPS certificate'
ask PERSONAL_AGENT_PROVIDER 'Model provider type' openai
ask PERSONAL_AGENT_MODEL 'Model' deepseek/deepseek-v4.1-flash
ask PERSONAL_AGENT_BASE_URL 'Provider base URL' https://ai-gateway.vercel.sh/v1
ask PERSONAL_AGENT_API_KEY_ENV 'Name of the key variable' AI_GATEWAY_API_KEY
case "$PERSONAL_AGENT_API_KEY_ENV" in
  *[!A-Za-z0-9_]* | [0-9]*) fail 'the key variable name must be letters, digits and underscores' ;;
esac

umask 077
cat >"$bundle/.env" <<EOF
PERSONAL_AGENT_DOMAIN=$PERSONAL_AGENT_DOMAIN
PERSONAL_AGENT_ACME_EMAIL=$PERSONAL_AGENT_ACME_EMAIL
PERSONAL_AGENT_PROVIDER=$PERSONAL_AGENT_PROVIDER
PERSONAL_AGENT_MODEL=$PERSONAL_AGENT_MODEL
PERSONAL_AGENT_BASE_URL=$PERSONAL_AGENT_BASE_URL
PERSONAL_AGENT_API_KEY_ENV=$PERSONAL_AGENT_API_KEY_ENV
EOF

if [ ! -s "$bundle/secrets.env" ]; then
  eval "key=\${$PERSONAL_AGENT_API_KEY_ENV:-}"
  if [ -z "$key" ]; then
    printf 'Paste the %s (input hidden): ' "$PERSONAL_AGENT_API_KEY_ENV"
    # Echo comes back even if the prompt is interrupted.
    trap 'stty echo </dev/tty 2>/dev/null || true' EXIT INT TERM
    stty -echo </dev/tty 2>/dev/null || true
    read -r key </dev/tty || true
    stty echo </dev/tty 2>/dev/null || true
    trap - EXIT INT TERM
    printf '\n'
  fi
  [ -n "$key" ] || fail 'a provider key is required'
  printf '%s=%s\n' "$PERSONAL_AGENT_API_KEY_ENV" "$key" >"$bundle/secrets.env"
  unset key
fi
chmod 600 "$bundle/.env" "$bundle/secrets.env"

say '== Building and starting (the first build takes a few minutes)'
cd "$bundle"
docker compose up -d --build

say '== Waiting for the agent'
code=''
for _ in $(seq 1 120); do
  code="$(docker compose logs personal-agent 2>/dev/null | sed -n 's/.*Access code: //p' | tail -1)"
  [ -n "$code" ] && break
  sleep 2
done
[ -n "$code" ] || fail "the agent did not start; see: cd $bundle && docker compose logs"

say ''
say "Your personal agent is at https://$PERSONAL_AGENT_DOMAIN"
say "Access code: $code"
say ''
say "Print the code again:  cd $bundle && docker compose exec personal-agent personal-agent access-code"
say "Update later:          sudo sh $bundle/install.sh   (keeps your settings, key and data)"
