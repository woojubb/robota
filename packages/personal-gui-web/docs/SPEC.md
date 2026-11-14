# @robota-sdk/personal-gui-web — SPEC

## Purpose

The personal agent's web UI: the shared session surface (`@robota-sdk/agent-ui-web`) for chat, inside a
menu shell for what a personal agent keeps — the library of what it knows about the person, search
and settings. `apps/personal-agent` serves its build behind the shared access-code server, locally
now and from a server later.

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
- **The person's word, labelled as such.** A fact the person adds or corrects in the library is
  theirs; facts the agent read elsewhere are shown with where they came from.
- **Secrets stay out of the page.** Settings name the environment variable that holds a provider key;
  the key itself is never sent to or shown by the page.

## Non-goals

- Ships no importable module.
- Does not serve itself, mint tokens or admit a browser — the personal agent's root and the shared
  access-code server do.

## Design decisions

- The shell keeps the chat mounted while another menu is open, so a session and its draft survive a
  trip to the library.
- A menu appears only when the capability behind it exists, so the shell grows with the personal
  pack instead of showing empty places.
