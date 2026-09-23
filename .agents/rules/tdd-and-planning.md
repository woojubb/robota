# TDD and Planning

Parent: [AGENTS.md](../../AGENTS.md)

Plan only to the depth needed to make the implementation decision clear. A concise plan in the authoritative issue, request, or PR is sufficient for ordinary work and does not require its own commit.

For observable behavior changes:

1. Reproduce or characterize the failure.
2. Add a focused failing test when practical.
3. Implement the smallest complete correction.
4. Refactor while the focused suite remains green.
5. Run affected integration or user-surface verification proportional to risk.

Documentation-only, mechanical, or configuration changes may use direct before/after assertions instead of manufacturing a unit-test cycle. Never add a ceremony artifact merely to claim TDD.
