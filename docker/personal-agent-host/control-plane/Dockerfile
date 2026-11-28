# syntax=docker/dockerfile:1
#
# The personal-agent host control plane, built from this repository's sources. See ../README.md.
# The build context is the repository root; `docker compose` supplies it.
#
# The image holds only the built program: the control plane has no runtime dependencies, and it
# applies the network guard and runs every unit through the container engine's API, so it carries
# neither the firewall tool nor an engine client.

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
WORKDIR /src
COPY . .
RUN --mount=type=secret,id=extra-ca,required=false \
  set -eu; \
  if [ -f /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi; \
  npm install --global --no-audit --no-fund "$(node -p 'require("./package.json").packageManager')"; \
  pnpm install --frozen-lockfile --filter "robota-personal-agent-host..."; \
  pnpm --filter robota-personal-agent-host build

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

# Root-owned and read-only, so nothing running in the container can change the program.
COPY --from=build --chown=root:root /src/apps/personal-agent-host/package.json /opt/personal-agent-host/package.json
COPY --from=build --chown=root:root /src/apps/personal-agent-host/bin /opt/personal-agent-host/bin
COPY --from=build --chown=root:root /src/apps/personal-agent-host/dist /opt/personal-agent-host/dist
RUN chmod -R a-w /opt/personal-agent-host \
  && ln -s /opt/personal-agent-host/bin/personal-agent-host.mjs /usr/local/bin/personal-agent-host

# The state directory is the only writable place and is mounted in by the compose file.
ENV PERSONAL_AGENT_HOST_STATE_DIR=/var/lib/personal-agent-host
WORKDIR /opt/personal-agent-host
ENTRYPOINT ["personal-agent-host"]
CMD ["serve"]
