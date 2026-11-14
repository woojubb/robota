# syntax=docker/dockerfile:1
#
# The personal agent, built from this repository's sources. See README.md in this directory.
#
#   docker build -f docker/personal-agent/Dockerfile -t personal-agent:local .
#
# The build context is the repository root. A build behind a proxy that re-signs TLS can hand its
# CA certificate in as a build secret (`--secret id=extra-ca,src=<file>`); it is used for the install
# step only and never becomes part of the image.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY . .
RUN --mount=type=secret,id=extra-ca,required=false \
  set -eu; \
  if [ -f /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi; \
  npm install --global --no-audit --no-fund pnpm@8.15.4; \
  pnpm install --frozen-lockfile --filter "robota-personal-agent..."; \
  pnpm --filter "robota-personal-agent^..." build; \
  pnpm --filter robota-personal-agent deploy --prod /out

FROM node:22-bookworm-slim

# Chromium for the agent's own browser comes from the distribution; tini reaps the browser's
# children and forwards stop signals.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium tini ca-certificates fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# Installed root-owned, so the agent (running as `node`) cannot modify its own program.
COPY --from=build --chown=root:root /out /opt/personal-agent
RUN chmod -R a-w /opt/personal-agent \
  && ln -s /opt/personal-agent/bin/personal-agent.mjs /usr/local/bin/personal-agent

ENV HOME=/home/node \
    PERSONAL_AGENT_STATE_DIR=/home/node/.personal \
    PERSONAL_AGENT_CHROMIUM=/usr/bin/chromium

RUN mkdir -p /home/node/.personal && chown node:node /home/node/.personal && chmod 0700 /home/node/.personal

# Configures the provider from the environment on every start (the key itself is only ever read
# from the variable PERSONAL_AGENT_API_KEY_ENV names), then runs the agent in the foreground,
# published through the host's reverse proxy when PERSONAL_AGENT_PUBLIC_URL is set.
COPY --chmod=0755 <<'EOF' /usr/local/bin/personal-agent-entrypoint
#!/bin/sh
set -eu
if [ -n "${PERSONAL_AGENT_PROVIDER:-}" ]; then
  set -- --type "$PERSONAL_AGENT_PROVIDER" --model "${PERSONAL_AGENT_MODEL:?PERSONAL_AGENT_MODEL is required with PERSONAL_AGENT_PROVIDER}"
  if [ -n "${PERSONAL_AGENT_BASE_URL:-}" ]; then set -- "$@" --base-url "$PERSONAL_AGENT_BASE_URL"; fi
  if [ -n "${PERSONAL_AGENT_API_KEY_ENV:-}" ]; then set -- "$@" --api-key-env "$PERSONAL_AGENT_API_KEY_ENV"; fi
  personal-agent configure "$@"
fi
# Published through a TLS reverse proxy on the host when a public URL is given.
if [ -n "${PERSONAL_AGENT_PUBLIC_URL:-}" ]; then exec personal-agent start --server; fi
exec personal-agent start
EOF

USER node
WORKDIR /home/node
VOLUME ["/home/node/.personal"]
ENTRYPOINT ["tini", "--", "personal-agent-entrypoint"]
