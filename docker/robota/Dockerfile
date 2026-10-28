# syntax=docker/dockerfile:1
#
# Robota agent image. See README.md in this directory for the host options the inner OS sandbox
# needs, credentials, trust and workspace guidance.
#
#   docker/robota/pack-local.sh
#   docker build --build-arg ROBOTA_SOURCE=local -t robota:local docker/robota
#
# ROBOTA_SOURCE=registry (default) installs @robota-sdk/agent-cli@${ROBOTA_VERSION} from npm.
# ROBOTA_SOURCE=local installs the CLI tarball `pack-local.sh` wrote to local-packages/. That path
# is for verifying unreleased changes before a release only; a deployed image comes from a release.

FROM node:22-bookworm-slim

ARG ROBOTA_VERSION=3.0.0-beta.90
ARG ROBOTA_SOURCE=registry
ARG ROBOTA_LOCK_SHA256=

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bubblewrap \
    ca-certificates \
    git \
    tini \
  && rm -rf /var/lib/apt/lists/*

# The CLI is installed root-owned under /opt/robota, so the agent (running as `node`) cannot
# modify the program that confines it. @robota-sdk/agent-cli bundles all Robota workspace code and
# depends only on third-party packages, so any other @robota-sdk package found after the install
# would not come from the selected source and fails the build. local-packages/ is bind-mounted for
# the install step only, so the tarball never becomes an image layer.
COPY --chmod=0444 release-package-lock.json /tmp/release-package-lock.json
COPY --chmod=0555 validate-release-lock.mjs /usr/local/lib/robota/validate-release-lock.mjs
RUN --mount=type=bind,source=local-packages,target=/tmp/local-packages \
  set -eu; \
  mkdir -p /opt/robota; \
  cd /opt/robota; \
  case "$ROBOTA_SOURCE" in \
    registry) \
      if ! printf '%s' "$ROBOTA_LOCK_SHA256" | grep -Eq '^[0-9a-f]{64}$'; then \
        echo "registry builds require the attested release lock digest" >&2; exit 1; \
      fi; \
      cp /tmp/release-package-lock.json package-lock.json; \
      node /usr/local/lib/robota/validate-release-lock.mjs package-lock.json package.json; \
      npm ci --omit=dev --ignore-scripts --no-audit --no-fund ;; \
    local) \
      echo '{"name":"robota-image","private":true}' > package.json; \
      set -- /tmp/local-packages/*.tgz; \
      if [ "$#" -ne 1 ] || [ ! -e "$1" ]; then \
        echo "local-packages/ must hold exactly the agent-cli tarball; run docker/robota/pack-local.sh" >&2; exit 1; \
      fi; \
      npm install --omit=dev --no-audit --no-fund "$1" ;; \
    *) echo "ROBOTA_SOURCE must be registry or local" >&2; exit 1 ;; \
  esac; \
  installed="$(find node_modules -path '*/@robota-sdk/*' -prune -print)"; \
  if [ "$installed" != "node_modules/@robota-sdk/agent-cli" ]; then \
    echo "only @robota-sdk/agent-cli may be installed; found: $installed" >&2; exit 1; \
  fi; \
  rm -f /tmp/release-package-lock.json package-lock.json; \
  npm cache clean --force; \
  ln -s /opt/robota/node_modules/.bin/robota /usr/local/bin/robota; \
  robota --version

ENV HOME=/home/node \
    PRODUCT_USER_STATE_DIR=/home/node/.robota

RUN mkdir -p /home/node/.robota /workspace /usr/local/share/robota \
  && chown node:node /home/node/.robota /workspace \
  && chmod 0700 /home/node/.robota

COPY --chmod=0755 entrypoint.sh /usr/local/bin/robota-entrypoint
COPY --chmod=0644 default-settings.json /usr/local/share/robota/default-settings.json

USER node
WORKDIR /workspace
VOLUME ["/home/node/.robota", "/workspace"]

ENTRYPOINT ["tini", "--", "robota-entrypoint"]
CMD ["robota", "--help"]
