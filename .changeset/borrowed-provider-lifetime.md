---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-roundtable-robota': patch
---

Allow explicitly borrowed providers to outlive agent destruction and Session shutdown while keeping
owned providers as the default. Track replaced and removed provider cleanup, expose current provider
registrations after swapping, and hold Roundtable resource leases until runtime teardown finishes.
Borrowing does not permit concurrent provider use across leases.
