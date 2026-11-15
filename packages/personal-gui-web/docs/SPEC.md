# @robota-sdk/personal-gui-web — SPEC

## Purpose

The personal agent's web UI: the shared session surface (`@robota-sdk/agent-ui-web`) for chat, inside a
menu shell for what a personal agent keeps — the feed of results and approvals, ideas, its goals, spaces, the library
of what it knows about the person, the services it is connected to, search and settings. `apps/personal-agent` serves its build behind
the shared access-code server.

It is a **`private` product-shell package**: a product UI assembled from the shared libraries, not an
importable library.

## Contract

- **Presentation only.** Chat is the session surface over the agent's WebSocket; everything else is
  read and written through the personal agent's API beside the page. The page holds no domain logic:
  what is kept, how it is forgotten and what may be saved are decided by the agent.
- **One credential, the page's own.** API calls are relative to the page, so they ride the cookie of
  the access-code session path the page was served from; every call that changes something carries
  the write header the server requires. The built page may reach only its own origin and a loopback
  WebSocket.
- **An approval answers the real request.** Approving or declining in the feed resolves the very
  action a goal is waiting on; the page shows the method and address being approved.
- **The person's word, labelled as such.** A fact the person adds or corrects in the library is
  theirs; facts the agent read elsewhere are shown with where they came from.
- **A connection is made by the person, in this browser.** The Connectors tab starts a sign-in and
  opens the service's own page for the person; the agent's machine opens nothing. The page shows a
  connection's state as a fixed word and the scopes the service says it granted, never a credential,
  and shows what each tool may do split into reading (on its own) and writing (the person approves
  every call). The page records the person's decision about a tool; deciding what a tool is by
  default stays with the agent. Keeping a service's content in the library up to date is the
  person's switch, and disconnecting asks whether to keep or forget what the service put there.
- **Secrets stay out of the page.** Settings name the environment variable that holds a provider key;
  the key itself is never sent to or shown by the page.

## Non-goals

- Ships no importable module.
- Does not serve itself, mint tokens or admit a browser — the personal agent's root and the shared
  access-code server do.

## Design decisions

- The shell keeps the chat mounted while another menu is open, so a session and its draft survive a
  trip to the library.
- The menu is the person's own: their spaces are tabs beside the fixed ones, in an order they choose
  and the agent keeps with their other state, so it follows them across browsers. Anything else the
  menu offers (settings, search, a new chat) stays out of the tabs, at its foot.
- A side chat is a second connection with a chat of its own, so nothing said there reaches the main
  chat unless the person brings it back, and then as their own message. It can start from the main
  chat's latest turns, quoted in the person's first message rather than shared, and the menu lists
  side chats apart, each linked to the chat it was started beside.
