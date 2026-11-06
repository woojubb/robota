# @robota-sdk/agent-node-lock

Node-only nonblocking operation locks for cooperating local processes. A guard is held until release or process exit. Every participant must use the same lock directory and name, and the guard path must remain in place while the namespace is in use.

The lock does not fence older implementations or a program that replaces the guard path. Network filesystem behavior is not qualified.
