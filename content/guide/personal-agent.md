# The Personal Agent

The personal agent is a long-running assistant built by composing the Robota SDK (`apps/personal-agent`).
It runs on your machine and you use it from its own web UI. It remembers what you tell it in a library
you can read and edit, keeps ideas for later, and works on goals while you are away. It asks you before
anything that sends data somewhere or spends money.

## Run it from source

```sh
pnpm install
pnpm --filter "robota-personal-agent^..." build     # the SDK packages and the web UI it serves
export OPENAI_API_KEY=...                            # or any provider's key
node apps/personal-agent/bin/personal-agent.mjs configure --type openai --model <model> --api-key-env OPENAI_API_KEY
node apps/personal-agent/bin/personal-agent.mjs start
```

A model gateway that speaks the OpenAI API works the same way: give its address and the gateway's
model id, for example `configure --type openai --base-url https://ai-gateway.vercel.sh/v1 --model
deepseek/deepseek-v4.1-flash --api-key-env AI_GATEWAY_API_KEY`, or `--type openrouter` with
`OPENROUTER_API_KEY`.

`start` prints a loopback URL and an access code. Open the URL, type the code, and you are in. It also
prints an HTTP API address and the bearer for scripts.

- `--type` takes any built-in provider type. An OpenAI-compatible endpoint is `--type openai --base-url <url>`.
- The key is never written to disk: the profile keeps only the name of the environment variable holding it.
- Settings in the web UI change the same profile; restart to use a new one. (In the container the
  profile comes from its environment instead; see below.)

## The menus

| Menu | What it is for |
| --- | --- |
| **New chat** / **Chat** | Talk with your agent. Earlier chats are listed and can be reopened. |
| **Feed** | Results from your goals, and actions waiting for your approval. Approve or decline here. |
| **Ideas** | Thoughts kept for later, yours or suggested by your agent (marked as such). Make one a goal when you want. |
| **Goals** | What your agent keeps working on, once or on a schedule, with each run's report and what it did. |
| **Spaces** | Areas of your life with your own instructions and pinned library pages; a chat started in a space opens with them. |
| **Side chat** | A quick chat beside the main one, optionally starting from the main chat's latest turns. Side chats are listed in the menu; bring an answer back when you want it there. |
| **Library** | What your agent knows about you, page by page, with where each fact came from. Correct or forget anything. |
| **Search** | Find anything in your library. |
| **Settings** | Model, browser, and where your data lives. |

## What keeps it safe

- **It asks before consequential actions.** Anything that would send data to a site (a form, a
  purchase) is held, and goes out only when you approve that exact request, showing its method and
  address. A goal that hits such an action waits in your Feed.
- **Its browser is its own.** It cannot reach your local network or private addresses, every redirect
  is checked, and pages are read as information, never as instructions. It does not hold reads: do
  not ask it to put private information into a web address.
- **It forgets for real.** Forgetting a fact or a page removes it from every page, link and log
  entry that held it.
- **Secrets are refused.** Passwords, keys and similar strings are not kept in the library, ideas or goals.
- **No shell.** The agent has no command line; its file tools reach only its own workspace folder.

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
(`ideas/`), the browser profile, and the agent's `workspace/`. Back the folder up to keep everything.

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
