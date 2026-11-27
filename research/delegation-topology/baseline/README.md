# Single-agent baseline (historical, pinned)

This directory pins the harness, fixtures and evidence of an earlier single-agent run. It is the reference point for a later comparison between one agent and a delegating parent with child agents. Nothing here is executed by CI, and the files are kept as they were produced (see Scrubs). `MANIFEST.json` lists every file with its SHA-256 and size.

## Method

- Five small synthetic repository tasks: navigation, bug repair, feature, multi-file change and test diagnosis. Each has a broken control and a solved control.
- Three measured trials per task, run serially, plus separately numbered fresh recovery fixtures for trials that stopped on infrastructure.
- The real headless runtime with its native non-streaming chat adapter and the built-in read, write, edit, glob and grep tools. No shell, network or delegation tools. Temperature 0.2, high reasoning effort, 8 turns and 8,192 output tokens per request.
- Each trial ran in a non-root, network-disabled container with a new synthetic repository, a disposable `HOME` and a disposable product state directory. A host relay held the credential and made the upstream call; the container never saw it. No automatic retry of a paid request.
- Verification ran in separate read-only, network-disabled containers using immutable verifiers. A pass required the verifier to succeed, protected files unchanged, no unexpected files, a completed response and actual tool use.
- Offline controls ran first: broken and solved fixtures, isolation canaries, and a native-runtime scripted replay.
- After the run: a cleanup audit (containers, image, worktree, branch, fixtures, build cache) and a key-leak scan that found no match of the credential value in any retained artifact.

## Result

- 15 of 15 measured outcomes passed. Counting the three trials that stopped on infrastructure (a receipt-ingestion delay, a receipt-network timeout and a provider capacity rejection), 15 of 18 attempts.
- 69 dispatched inference requests; 68 settled with a generation receipt confirming the model and provider route.
- Tokens over all returned completions, failed attempts included: 129,384 prompt (104,174 cached), 11,869 completion.

## Cost bound

The settled subtotal is US$0.027530844. One request (a capacity rejection) has no captured receipt, so its cost is unknown and its full US$0.125 reservation stays counted. Settled cost plus that one retained reservation is **US$0.152530844**. This is a bound, not a reconciled invoice. All 69 cumulative reservations total US$8.625, under the original US$10 cap; no reservation was reset or released.

## Limits

- The run used an older runtime revision than current development; a later comparison must either rerun the single-agent arm on the same revision or state the gap.
- Trials were serial and kept provider-side cache effects; the figures are not cold-cache prices.
- The session cost fields recorded by the runtime were estimates and are separate from the provider receipts.
- The tasks are small and synthetic. They show compatibility and observed correctness only, not broad reliability, and say nothing about delegation.
- Model wire transcripts are not kept; only their SHA-256 and size are listed in `MANIFEST.json`.
- The exact model and route appear only as configuration data inside the copied JSON evidence, not in this prose.

## Layout

- `harness/`: runner, image build script, task definitions, in-container worker, summary script and Dockerfile.
- `harness-revisions/`: the two earlier runner revisions used by the resumed runs, with their ledgers and results. Run logs are not kept (the repository ignores log files; their content repeats the results files).
- `fixtures/`: the synthetic repository snapshots used by the trials.
- `evidence/trials/`: one result file per trial attempt.
- `evidence/controls/`: offline, capacity, receipt, recovery and report control results.
- `evidence/ledger-and-run/`: the append-only budget ledger, aggregate results and summary, run and report manifests, the endpoint catalog snapshot and the two receipt reconciliations.
- `evidence/` also holds the cleanup record, evidence audit, review record and build-cache record.

## Verification of this copy

Hashes of the runner and worker match the values pinned when the baseline closed; other scripts and evidence files match the hashes in the run and report manifests (`hashVerification` in `MANIFEST.json`). Fixture files match the hashes in the results file. A secret scan found no findings.

## Scrubs

Host-specific text was replaced in four scripts: two absolute host paths in each runner revision (source checkout and credential env file) and one tracker reference in the summary script. `sha256BeforeScrub` in `MANIFEST.json` is the hash of the original bytes, which is what the pins refer to. The scripts therefore need those two paths supplied before they can run again.
