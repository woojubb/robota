# Personal agent image

The personal agent (`apps/personal-agent`) built from this repository's sources, with Chromium for the
agent's own browser. How to use the agent is in [content/guide/personal-agent.md](../../content/guide/personal-agent.md).

```sh
docker build -f docker/personal-agent/Dockerfile -t personal-agent:local .
docker/personal-agent/smoke.sh personal-agent:local
OPENAI_API_KEY=... docker compose -f docker/personal-agent/compose.yaml up
```

- **Configuration** comes from the environment at each start: `PERSONAL_AGENT_PROVIDER`,
  `PERSONAL_AGENT_MODEL`, optional `PERSONAL_AGENT_BASE_URL`, and `PERSONAL_AGENT_API_KEY_ENV`, the name of
  the variable holding the key. Only that name is saved; the key stays in the environment.
- **Hosted units:** a host that runs the image on a network of its own (`apps/personal-agent-host`) sets
  `PERSONAL_AGENT_INGRESS_ADDR` to the unit's address; the entrypoint then also runs a small forwarder that
  relays the agent's two ports from that address to its loopback ones. Unset, nothing changes.
- **Network:** local mode listens on loopback only, so the container uses the host's network
  (`network_mode: host`, Linux).
- **Hardening:** the program is root-owned and read-only. The agent runs as `node`, with every
  capability dropped, `no-new-privileges` and a read-only root filesystem. Its only writable places are
  the state volume and `/tmp`.
- **On a server:** [`server/`](server/) publishes the agent over HTTPS with Caddy, and
  [`server/install.sh`](server/install.sh) sets it up on a fresh Ubuntu or Debian VPS. The agent still
  binds loopback only; set `PERSONAL_AGENT_PUBLIC_URL` and the image starts it with `--server`.
- **Behind a proxy that re-signs TLS,** pass its CA as a build secret
  (`--secret id=extra-ca,src=<file>`). It is used for the install step only.
