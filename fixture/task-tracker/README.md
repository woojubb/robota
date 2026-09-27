# Task Tracker

A tiny in-memory task tracker used as a fixture project.

## Layout

- `src/task-title.ts` — validates a task title before a task is created.
- `src/tasks.ts` — creates and lists tasks.
- `test/` — unit tests (Node's built-in test runner).

## Run the tests

```bash
npm test
```

Requires Node 22.6 or later (the tests run TypeScript through `--experimental-strip-types`).
