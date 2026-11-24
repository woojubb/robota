# @robota-sdk/personal-gui-web — SPEC

## Purpose

The personal agent's web UI: the shared session surface (`@robota-sdk/agent-ui-web`) for chat, inside a
menu shell for what a personal agent keeps — the feed of results, approvals and questions, ideas, its goals, spaces, the library
of what it knows about the person, the services it is connected to, the work it can take on, search and settings. `apps/personal-agent` serves its build behind
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
- **A question records an answer and nothing more.** Answering in the feed records the person's choice or
  reply on the case; it approves nothing and sends nothing. A question the agent withdrew cannot be
  answered, and a waiting one is answered rather than dismissed. What the case rests on, and how it
  closed after the answer, came from elsewhere, often a mail, so both are shown as plain text and never as a link.
- **The person's word, labelled as such.** A fact the person adds or corrects in the library is
  theirs; facts the agent read elsewhere are shown with where they came from.
- **A connection is made by the person, in this browser.** The Connectors tab starts a sign-in and
  opens the service's own page for the person; the agent's machine opens nothing. The page shows a
  connection's state as a fixed word and the scopes the service says it granted, never a credential,
  and shows what each tool may do split into reading (on its own) and writing (the person approves
  every call). A client secret or token the person types for a sign-in goes with that one request and
  is emptied from the page as it goes; only a sign-in page comes back to this one, so only that way
  of signing in sends the page's address. The page records the person's decision about a tool; deciding what a tool is by
  default stays with the agent. Keeping a service's content in the library up to date is the
  person's switch, and so is what the agent should ask about when it checks: the page shows the words
  in force (the default for the kind of service until the person writes their own), keeps what the
  person types as plain text, and shows the agent's refusal of a text beside it. Disconnecting asks
  whether to keep or forget what the service put in the library. A
  suggested service only fills in the add form, so nothing is added until the person presses Add,
  and a suggestion's words are shown as plain text.
- **Browse shows the agent's word on each task, and decides none of it.** The Browse tab lists the agent's
  tasks as ready with the access they would use, needing the setup steps it names, or unavailable with
  its reason. Only a task the agent says is ready has a Start, with a form for the values it asks for;
  the agent judges the task again when Start is pressed, and the page shows its answer in the agent's
  own words. One request goes with one key, kept while nothing changed and no answer came back, so a
  double click or a retry is one request. A task that was started shows where it stands as the agent
  reports it: completed only for a result the agent checked, and unverified, with its report called
  unchecked and no word of success, for a run that ended without proof, and what the browser returned
  is called evidence only for a checked result. The report and what the agent's browser read are shown
  as plain text, the card reads the launch again while it is going and stops at its end, and it opens
  the goal and the Feed report. The Feed shows the report of a started task as plain text too, says where
  the task stands so an unchecked run does not look like a checked one, and opens the card back. An
  offer's reason can come from a source, so it is shown as plain text, never as a link or markup.
- **Secrets stay out of the page.** Settings name the environment variable that holds a provider key;
  the key itself is never sent to or shown by the page. The limits on what reaches the person beyond
  the feed, and the address they give to be notified at, are theirs: Settings saves the limits as typed,
  shows the agent's refusal of a value beside them instead of the browser's own, and says that the agent
  only suggests how urgent a question is; the address is sent once, its field emptied, and only its host
  shown afterwards, and the browser's permission to notify, and with it the worker that shows a push while the
  page is closed, is asked for only when the person presses its button; the page keeps and shows no push address
  or key, only how many browsers are subscribed and whether this browser is among them. The person can
  remove subscriptions left at an old browser or address from the agent.

## Non-goals

- Ships no importable module.
- Does not serve itself, mint tokens or admit a browser — the personal agent's root and the shared
  access-code server do.

## Design decisions

- The shell asks the agent for new messages every few seconds on whichever tab is showing, which is also
  how the agent knows a page is open to take a push; it shows one as a browser notification only while the
  page is not in front of the person, and the tab title counts the questions waiting in the feed.
- The shell keeps the chat mounted while another menu is open, so a session and its draft survive a
  trip to the library.
- The menu is the person's own: their spaces are tabs beside the fixed ones, in an order they choose
  and the agent keeps with their other state, so it follows them across browsers. Anything else the
  menu offers (settings, search, a new chat) stays out of the tabs, at its foot.
- A side chat is a second connection with a chat of its own, so nothing said there reaches the main
  chat unless the person brings it back, and then as their own message. It can start from the main
  chat's latest turns, quoted in the person's first message rather than shared, and the menu lists
  side chats apart, each linked to the chat it was started beside.
