---
'@robota-sdk/agent-cli': minor
---

`secure` is now a reserved first word on the command line: `robota secure setup | status | verify |
change-passphrase` manages the keyring for secure conversations, with secrets typed at the terminal
only. A first argument that is exactly `secure` therefore runs that command instead of starting a
session with the words as its prompt.

What to do: to start a session whose prompt begins with "secure", pass the prompt as one quoted
argument (`robota "secure the config"`) or after `--`.
