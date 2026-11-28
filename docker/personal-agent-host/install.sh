#!/bin/sh
# Installs the personal-agent host on a Debian-family server that already runs a container engine:
# the control plane and the HTTPS proxy from compose.yaml beside this script, the state directory
# owner-only, and a `personal-agent-host` command that talks to the control plane's admin socket.
# Run it as root (or with sudo); it is safe to run again and keeps your settings and accounts.
#
#   sudo sh install.sh            install or update
#   sh install.sh --dry-run       print the plan and check the prerequisites; changes nothing
#
# It never asks for a model key and stores none: keys are given to `personal-agent-host add`.
# Settings (each may be given ahead as an environment variable): PERSONAL_AGENT_HOST_BASE_DOMAIN,
# PERSONAL_AGENT_HOST_TLS (an ACME email, or "internal" for a test), PERSONAL_AGENT_HOST_ALLOW_CONTAINER,
# the optional ones listed in example.env, and PERSONAL_AGENT_HOST_BIN_DIR (default /usr/local/bin).
set -eu

repo_url="${PERSONAL_AGENT_HOST_REPO:-https://github.com/woojubb/robota.git}"
repo_ref="${PERSONAL_AGENT_HOST_REF:-main}"
install_dir="${PERSONAL_AGENT_HOST_DIR:-/opt/robota}"
bin_dir="${PERSONAL_AGENT_HOST_BIN_DIR:-/usr/local/bin}"
container='personal-agent-host-control-plane'
settings='BASE_DOMAIN TLS ALLOW_CONTAINER HTTP_PORT HTTPS_PORT SUBNET_POOL DNS_SERVERS MEMORY_MB CPUS PIDS STATE_PATH ENGINE_SOCKET'

dry_run=0

say() { printf '%s\n' "$*"; }
fail() { printf 'install: %s\n' "$*" >&2; exit 1; }
usage() {
  say 'Usage: sh install.sh [--dry-run] [--help]'
  say '  --dry-run  print the plan and check the prerequisites; change nothing (no root needed)'
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --help | -h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[ "$dry_run" = 1 ] || [ "$(id -u)" = 0 ] || fail 'run this as root, for example: sudo sh install.sh'

# The bundle is the directory this script is in; a script fetched on its own clones the repository.
here="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$here/compose.yaml" ]; then
  bundle="$here"
else
  bundle="$install_dir/docker/personal-agent-host"
fi

# What the settings were last time: the settings file holds only plain NAME=value lines.
if [ -f "$bundle/.env" ]; then
  while IFS='=' read -r name value; do
    case "$name" in
      PERSONAL_AGENT_HOST_*[!A-Z_]*) ;;
      PERSONAL_AGENT_HOST_*) eval "[ -n \"\${$name:-}\" ] || $name=\$value" ;;
    esac
  done <"$bundle/.env"
fi

state_path="${PERSONAL_AGENT_HOST_STATE_PATH:-/var/lib/personal-agent-host}"
case "$state_path" in
  /*[!A-Za-z0-9._/-]* | /*..* | / | '') fail 'PERSONAL_AGENT_HOST_STATE_PATH must be a plain absolute path' ;;
  /*) ;;
  *) fail 'PERSONAL_AGENT_HOST_STATE_PATH must be an absolute path' ;;
esac

check_prerequisites() {
  problems=0
  need() { printf 'missing: %s\n' "$*" >&2; problems=$((problems + 1)); }
  [ "$(uname -s)" = Linux ] || need 'a Linux server (the network guard needs nf_tables)'
  if ! command -v docker >/dev/null 2>&1; then
    need 'a container engine: install Docker (docker.io or docker-ce) and run this again'
  elif ! docker info >/dev/null 2>&1; then
    need 'a reachable container engine: is the Docker service running, and are you root?'
  else
    api="$(docker version --format '{{.Server.APIVersion}}' 2>/dev/null || true)"
    case "$api" in
      '' | 1.[0-3]? | 1.4[0]) need "a container engine with API 1.41 or newer (this one reports '${api:-unknown}')" ;;
    esac
    docker compose version >/dev/null 2>&1 \
      || need 'Docker Compose v2: install the docker-compose-v2 or docker-compose-plugin package'
  fi
  if [ "$dry_run" = 0 ]; then modprobe -q nf_tables 2>/dev/null || true; fi
  if [ ! -d /sys/module/nf_tables ] && ! grep -qw nf_tables /proc/modules 2>/dev/null; then
    need 'the nf_tables kernel module (the network guard cannot run without it)'
  fi
  if [ ! -f "$here/compose.yaml" ] && ! command -v git >/dev/null 2>&1; then
    need 'git, to fetch this repository'
  fi
  [ "$problems" = 0 ]
}

say '== Checking the prerequisites'
check_prerequisites || fail 'fix the problems above, then run this again'

if [ "$dry_run" = 1 ]; then
  say "== Plan (nothing was changed)"
  [ -f "$here/compose.yaml" ] || say "  fetch $repo_url ($repo_ref) into $install_dir"
  say "  create $state_path and $state_path/proxy, owner-only (mode 700), under umask 077"
  say "  write $bundle/.env from the settings (owner-only; it never holds a model key)"
  say "  build the control-plane, unit and guard images, then start the control plane and the proxy"
  say "  install $bin_dir/personal-agent-host, which runs the CLI against the admin socket"
  exit 0
fi

if [ ! -f "$here/compose.yaml" ]; then
  say "== Getting the repository into $install_dir"
  if [ -d "$install_dir/.git" ]; then
    git -C "$install_dir" fetch -q origin "$repo_ref"
    git -C "$install_dir" checkout -q --detach FETCH_HEAD
  else
    git clone -q --depth 1 --branch "$repo_ref" "$repo_url" "$install_dir"
  fi
fi

ask() {
  # ask VAR "Question" [default]: keep a value given in the environment, else read one.
  var="$1"; question="$2"; default="${3:-}"
  eval "current=\${$var:-}"
  if [ -z "$current" ]; then
    if [ -n "$default" ]; then printf '%s [%s]: ' "$question" "$default"; else printf '%s: ' "$question"; fi
    read -r current </dev/tty || true
    [ -n "$current" ] || current="$default"
  fi
  [ -n "$current" ] || fail "$question is required (or set $var)"
  eval "$var=\$current"
}

say '== Settings'
ask PERSONAL_AGENT_HOST_BASE_DOMAIN 'Domain accounts live under (each is <id>.<domain>; its DNS must point here)'
ask PERSONAL_AGENT_HOST_TLS 'Email for the HTTPS certificates ("internal" only for a test)'
if [ "${PERSONAL_AGENT_HOST_ALLOW_CONTAINER:-}" != true ]; then
  say 'Accounts run as containers that share this server'"'"'s kernel and have no disk quota, and root on'
  say 'this server can see every account'"'"'s model key: use this only for accounts you trust.'
  ask PERSONAL_AGENT_HOST_ALLOW_CONTAINER 'Type true to confirm'
  [ "$PERSONAL_AGENT_HOST_ALLOW_CONTAINER" = true ] || fail 'not confirmed; nothing was installed'
fi
PERSONAL_AGENT_HOST_STATE_PATH="$state_path"

umask 077
mkdir -p "$state_path" "$state_path/proxy"
chmod 700 "$state_path" "$state_path/proxy"

# One line per setting that has a value; a value is plain text, so it cannot add a setting or a command.
: >"$bundle/.env.new"
for setting in $settings; do
  name="PERSONAL_AGENT_HOST_$setting"
  eval "value=\${$name:-}"
  [ -n "$value" ] || continue
  case "$value" in
    *[!A-Za-z0-9._@:/,+-]*) rm -f "$bundle/.env.new"; fail "$name holds a character that is not allowed in a setting" ;;
  esac
  printf '%s=%s\n' "$name" "$value" >>"$bundle/.env.new"
done
chmod 600 "$bundle/.env.new"
mv "$bundle/.env.new" "$bundle/.env"

say '== Building and starting (the first build takes several minutes)'
cd "$bundle"
docker compose --profile build build
docker compose up -d

say "== Installing $bin_dir/personal-agent-host"
mkdir -p "$bin_dir"
wrapper="$bin_dir/personal-agent-host"
cat >"$wrapper.new" <<EOF
#!/bin/sh
# Runs the personal-agent-host CLI inside the control plane, against its admin socket.
# It needs the container engine, so run it as root: sudo personal-agent-host list
set -eu
if [ -t 0 ]; then exec docker exec -it $container personal-agent-host "\$@"; fi
exec docker exec -i $container personal-agent-host "\$@"
EOF
chmod 755 "$wrapper.new"
mv "$wrapper.new" "$wrapper"

say '== Waiting for the control plane'
ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" personal-agent-host list >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || fail "the control plane did not start; see: cd $bundle && docker compose logs control-plane"
docker exec "$container" personal-agent-host status

say ''
say "The host is running. Accounts will be at https://<id>.$PERSONAL_AGENT_HOST_BASE_DOMAIN"
say 'Add one (the model key is asked for without echo, or piped on stdin):'
say '  sudo personal-agent-host add alice --provider openai --model <model> --base-url <url>'
say "Update later: sudo sh $bundle/install.sh   (keeps your settings and accounts)"
