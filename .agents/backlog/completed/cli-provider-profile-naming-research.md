# CLI Provider Profile Naming Research

## Status

Completed.

## Priority

P1 - blocks a low-friction provider profile setup flow.

## Problem

Provider profiles need stable user-facing names because profile identity must not be derived from
provider type or model. Users may create multiple profiles with the same provider type and model when
they use different API keys, accounts, organizations, billing contexts, base URLs, or operational
defaults.

The setup flow should make profile registration easy. Requiring a name before every setup may add
friction, but silently generating names can create confusing profile lists if the generated names are
not readable or easy to rename.

## Research Questions

The current requirements are not contradictory if the research keeps three surfaces separate:
persistent default selection, one-shot invocation override, and interactive profile management.

- Should setup require users to enter a profile name, or should it propose one that can be accepted
  with Enter?
- When the interactive CLI starts with no configured profiles, what setup path gets users to a usable
  first profile with the fewest decisions?
- What default naming pattern is easiest to scan in `/provider list`?
- How should duplicate names be disambiguated when provider type and model are the same?
- Should generated names include provider type, model, credential hint, organization, endpoint, or a
  numeric suffix?
- How can the CLI avoid exposing sensitive credential details while still helping users distinguish
  profiles?
- Should temporary/generated names be explicitly marked until renamed?
- What rename/edit flow is needed if users accept a generated name during setup?
- How should headless setup flags support explicit names and generated defaults?
- Where should profile switching live for easiest access: startup prompt, `/provider`, `/model`,
  status bar action, command palette, CLI flag, or another command surface?
- How should the UX distinguish persistent profile switching from one-shot headless invocation with a
  specific profile?
- What headless command should change the persisted default profile without launching an agent
  session, and how should it differ from one-shot `--profile` startup?
- Should there be a headless command that opens an interactive profile switcher/manager TUI?
- Can the first-run setup TUI and explicit profile switcher TUI share the same profile management
  implementation?
- How complete does first-run profile management need to be if it becomes the reusable profile
  management surface?

## Candidate Directions To Evaluate

- Prompt with an editable default name, such as `claude-sonnet-4-6`, and append `-2`, `-3`, etc. for
  duplicates.
- Generate a readable name from provider type and model, then show non-sensitive metadata separately
  in profile lists, such as account label, org id, base URL host, or key fingerprint.
- Ask for a short user label only when a duplicate provider/model pair already exists.
- Let users optionally add a display label while keeping an internal stable profile key.
- Create temporary names such as `anthropic-1` only when necessary, then surface a rename prompt after
  setup succeeds.
- Keep persistent switching in `/provider` or a dedicated profile command, while headless startup uses
  a one-shot `--profile <name>`-style override that does not mutate the default selected profile.
- Add a separate non-session command, such as a profile/default command, for changing the persisted
  default profile in headless workflows.
- Provide an explicit command that opens profile management UI without starting a normal agent
  session, if interactive switching is important outside first-run setup.
- Expose the active profile in the status area and make the switch action discoverable from there, if
  the TUI command architecture supports it without moving profile semantics into rendering code.

## Acceptance Criteria

- [x] Research compares at least three naming UX options for interactive setup.
- [x] Recommendation covers same provider/model duplicates with different credentials.
- [x] Recommendation defines what profile list rows show so users can distinguish profiles safely.
- [x] Recommendation covers explicit naming flags for non-interactive setup.
- [x] Recommendation defines rename/edit behavior for generated or temporary names.
- [x] Recommendation identifies the easiest persistent switch surface for interactive users.
- [x] Recommendation distinguishes persistent default selection from one-shot invocation overrides.
- [x] Recommendation distinguishes one-shot headless startup, headless default-profile update, and
      headless-launched profile management TUI.
- [x] Recommendation defines whether first-run setup and profile management TUI share one component
      or workflow.
- [x] Recommendation identifies any required config shape changes, such as separating profile key from
      display label.
- [x] Recommendation keeps profile management semantics in SDK-owned APIs consumed by agent-cli.

## Result

Recommended and implemented the low-friction naming path:

- Do not prompt for a profile key in the first setup path. Generate a readable key from the selected
  model id and let users proceed with Enter-only defaults.
- Prefer model-derived keys such as `claude-sonnet-4-6`, `gpt-4o`, or
  `supergemma4-26b-uncensored-v2`; fall back to provider type only when no model is available.
- For duplicate keys, append numeric suffixes (`-2`, `-3`, ...). This supports same
  provider/model duplicates without treating `(type, model)` as unique identity.
- Do not include secrets, account identifiers, organization ids, or API key fragments in generated
  keys. `/provider list` and status output distinguish profiles with key, provider type, model, and
  non-secret endpoint metadata.
- Keep explicit non-interactive names through `--configure-provider <profile>`. Keep
  `--provider <profile>` as a one-shot override unless `--set-current` is also supplied.
- Keep persistent interactive switching in `/provider use <profile>`, with `/provider add` sharing
  the same SDK setup-flow primitives as first-run setup.
- Treat rename/edit/delete and a dedicated profile manager TUI as extensions of the same command
  interaction contract. They do not require a config-shape change because the profile key remains the
  stable identity and an optional display label can be added later if user research shows it is
  needed.

## Verification Plan

- Review existing provider setup and listing command behavior.
- Add proposed UX examples for:
  - first Anthropic Sonnet profile;
  - first CLI startup with no profiles;
  - second Anthropic Sonnet profile with a different API key;
  - Anthropic Opus profile;
  - OpenAI-compatible local profile with a base URL;
  - headless setup with explicit profile name;
  - headless startup using a profile without changing the persisted default;
  - headless command changing the persisted default without launching a session;
  - headless command opening profile switcher/manager TUI.
- Validate the recommendation against repository rules for secret handling and provider-neutral CLI
  behavior.
