# The Personal Agent

The personal agent is a long-running assistant built by composing the Robota SDK (`apps/personal-agent`).
It runs on your machine and you use it from its own web UI. It remembers what you tell it in a library
you can read and edit, keeps ideas for later, and works on goals while you are away. It asks you before
anything that sends data somewhere or spends money.

## Run it from source

```sh
pnpm install
pnpm --filter "robota-personal-agent^..." build     # the SDK packages and the web UI it serves
node apps/personal-agent/bin/personal-agent.mjs env          # opens your key file in your editor
node apps/personal-agent/bin/personal-agent.mjs configure --type openai --model <model> --api-key-env OPENAI_API_KEY
node apps/personal-agent/bin/personal-agent.mjs start
```

`env` creates `~/.robota/personal/.env`, readable only by you, and opens it in `$VISUAL`/`$EDITOR` (or
the system's text editor). Paste your key after the `=` of its line, for example `OPENAI_API_KEY=`, and
save. The agent reads the file each time it starts; a variable already exported in your shell wins.

A model gateway that speaks the OpenAI API works the same way: give its address and the gateway's
model id, for example `configure --type openai --base-url https://ai-gateway.vercel.sh/v1 --model
deepseek/deepseek-v4.1-flash --api-key-env AI_GATEWAY_API_KEY`, or `--type openrouter` with
`OPENROUTER_API_KEY`.

`start` prints a loopback URL and an access code. Open the URL, type the code, and you are in. It also
prints an HTTP API address and the bearer for scripts.

- `--type` takes any built-in provider type. An OpenAI-compatible endpoint is `--type openai --base-url <url>`.
- The profile keeps only the name of the variable holding the key; the key itself lives in your
  environment or in the owner-only `.env`, which the agent refuses to read if others can.
- Settings in the web UI change the same profile; restart to use a new one. (In the container the
  profile comes from its environment instead; see below.)

## The menus

The menu lists your tabs: the fixed ones and one per space, in your order (drag a tab, or press
Alt+Up/Down on it, to move it). On a narrow screen it opens from the menu button.

| Menu | What it is for |
| --- | --- |
| **Chat** | Talk with your agent. Earlier chats are in the chat's own list, one toggle away. |
| **Feed** | Results from your goals, and actions waiting for your approval. Approve or decline here. |
| **Ideas** | Thoughts kept for later, yours or suggested by your agent (marked as such). Make one a goal when you want. |
| **Goals** | What your agent keeps working on, once or on a schedule, with each run's report and what it did. |
| **Spaces** (one tab each) | Areas of your life with your own instructions and pinned library pages; a chat started in a space opens with them. **Create space** adds one. |
| **Side chats** | The round button in the chat starts a quick chat beside it, optionally from the main chat's latest turns. Side chats are listed in the menu; bring an answer back when you want it there. |
| **Library** | What your agent knows about you, page by page, with where each fact came from. Correct or forget anything. |
| **Connectors** | The services you connected (mail, calendar, files, chat, notes): sign in once, see what your agent may do there, keep them in sync, disconnect. |
| **Search** (foot of the menu) | Find anything in your library. |
| **Settings** (gear) and **New chat** (pen), foot of the menu | Model, browser, where your data lives; a fresh chat. |

## What keeps it safe

- **It asks before consequential actions.** Anything that would send data to a site (a form, a
  purchase) is held, and goes out only when you approve that exact request, showing its method and
  address. A goal that hits such an action waits in your Feed.
- **Its browser is its own.** It cannot reach your local network or private addresses, every redirect
  is checked, and pages are read as information, never as instructions. It does not hold reads: do
  not ask it to put private information into a web address. The globe button in the chat opens
  **Agent browser**: the page it is on, a picture of it, what it did there (never what it typed, only
  how much) and what waits for your approval. **Stop** ends what it is doing (the chat's turn, a goal's run, a
  messenger conversation's turn) and closes its pages.
- **It forgets for real.** Forgetting a fact or a page removes it from every page, link and log
  entry that held it.
- **Secrets are refused.** Passwords, keys and similar strings are not kept in the library, ideas or goals.
- **No shell.** The agent has no command line; its file tools reach only its own workspace folder.
- **A connected service is read freely and changed only with your approval.** Anything that sends or
  changes something there waits for you each time, in the chat or in your Feed. What it reads from
  a service is handed to the agent as information written by others, not as instructions, and a sync
  check has only the tools to read and file.

## Connect a service

A connector is a service you sign in to once so your agent can read it for you: mail, a calendar, files,
chat or notes. Any service that offers the standard tool interface (MCP over HTTPS, signed in with OAuth)
fits the same way; nothing is built in for one service.

1. If the service does not register clients automatically, register one with it yourself first: allow
   the redirect address the add form shows (`<the address you open this page at>/connector-callback`;
   `127.0.0.1` and `localhost` count as different addresses) and note its client id. The form has no
   place for a client secret, so a service that requires one from a client you registered yourself
   cannot be connected here.
2. Open **Connectors** and choose **Add a connector**: a name, what it is for, the service's `https`
   address and, for a service from step 1, the client id (and scopes).
3. Press **Connect**. The service's own page opens in *this* browser, the one you are using (the card
   also offers it as a link if a pop-up blocker stops it), so you sign in and agree there, wherever the
   agent runs, on your machine or on a server. The agent never sees your password. The service sends
   the browser back to the page's `/connector-callback` address, and the card shows **Connected** with
   the permissions the service reports, when it reports them in plain words. A sign-in left unfinished
   expires after a few minutes; **Start over** begins it again. If Connect ends in *Could not connect*,
   remove the connector and add it again with the right client id.

Only public values are kept in the connector. A secret the service itself issues when it registers your
agent is kept with the sign-in in `connector-credentials/`, readable only by you.

What the agent may do is shown per tool, in three groups: **Reads** it may use on its own, **Writes**
(anything that changes or sends) held for your approval every time, and **Blocked**. The groups follow
what the service says about each tool, and a tool that says nothing counts as a write. A select next to
each tool records your own decision over that; **Blocked** holds the tools you set to *Never allow*.

Turn on **sync** on a connected card to have the agent check it every 15 minutes, hour, 6 hours or day
(or press **Check now**). Each check is a goal of its own: it reads what is new and files the durable
facts in your Library, marked as read from that service with the item they came from, then reports in the
Feed unless it read the service cleanly and found nothing to keep, so a check that could not read is
never silent. A check has only the tools to read and file: it cannot write to the service, reach the web,
use the browser, or change what you told the agent. Turning sync off ends the checks and removes their
reports; the facts already filed stay in your Library. **Disconnect** deletes the sign-in and asks the
service to revoke it; **Remove** also deletes the connector itself. When your Library holds facts the
connector pulled, both ask whether to keep or forget them.

A service on your own network is refused by default, like the agent's browser. To reach one, list its
exact host names in `PERSONAL_AGENT_CONNECTOR_HOSTS` (comma-separated, for example `mail.lan`) and restart
the agent. Only the hosts you list are exempted from that refusal, and the service must still use `https`.

## Messengers

Any messenger can reach your agent through an adapter of the standard channel contract
(`createChannelHub` and `IChannelAdapter` in `@robota-sdk/agent-product/personal`). Only the sender ids
you verified for yourself on a channel get answers. Approvals arrive as buttons where the messenger has
them; elsewhere you get a note to approve in your Feed, because a typed "yes" is never an approval.
Goal reports are sent to your channels too. Approvals and reports go to the conversation you choose for
notices, so make it a direct chat with your agent, not a group. No messenger adapter ships yet; each is added as its own
adapter.

## Where it keeps things

Everything lives in one owner-only folder: `--state-dir <dir>`, else `PERSONAL_AGENT_STATE_DIR`, else
`~/.robota/personal`. It holds the profile (`config.json`), chats (`sessions/`), goal-run transcripts
(`goal-sessions/`), the library as plain Markdown (`wiki/`), goals and the feed (`goals/`), ideas
(`ideas/`), connectors (`connectors/`), their sign-ins (`connector-credentials/`, readable only by you),
the browser profile, and the agent's `workspace/`. Back the folder up to keep everything.

## Use it from anywhere: your own server

The agent can run on a small server (2 GB of memory leaves room for the first build) and be opened over HTTPS
from any browser. It still listens only on the server's loopback; Caddy, in the same bundle, holds the
certificate and forwards your domain to it. Point your domain's DNS at the server, open ports 80 and
443, then on the server:

```sh
curl -fsSLO https://raw.githubusercontent.com/woojubb/robota/main/docker/personal-agent/server/install.sh
sudo sh install.sh
```

It installs Docker, asks for the domain, an email for the certificate, the model and its key (typed
hidden, kept in an owner-only `secrets.env`), starts everything and prints the access code. The code
stays the same across restarts and updates; print it again with
`docker compose exec personal-agent personal-agent access-code` in `/opt/robota/docker/personal-agent/server`.
Run `install.sh` again to update; your settings, key and data are kept.

Without Docker, the same is `personal-agent start --server --public-url https://your.domain` behind any
TLS proxy that sends `/ws/` to port 7361 and everything else to port 7360 on loopback, keeping the
`Host` header.

## Run it in a container

The image builds from this repository and includes Chromium for the agent's browser:

```sh
OPENAI_API_KEY=... docker compose -f docker/personal-agent/compose.yaml up --build
docker compose -f docker/personal-agent/compose.yaml logs   # the URL, access code and HTTP bearer
```

The container takes its model from the `PERSONAL_AGENT_PROVIDER`, `PERSONAL_AGENT_MODEL`,
`PERSONAL_AGENT_BASE_URL` and `PERSONAL_AGENT_API_KEY_ENV` variables at every start, which replaces a
model chosen in Settings before it takes effect: change the variables instead. Local mode
serves only loopback, so the container shares the host's network (Linux). The state lives
in the `personal-agent-state` volume. `docker/personal-agent/smoke.sh` checks a built image against a
fixture model. Serving it to other machines safely (TLS, accounts) is a later server mode; until then,
reach a remote install through an SSH tunnel.
