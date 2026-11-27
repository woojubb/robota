#!/usr/bin/env python3
"""Summarize retained observations; no provider calls or changes to trial evidence."""
import collections
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parent
data = json.loads((ROOT / 'results.json').read_text())
ledger = json.loads((ROOT / 'ledger.json').read_text())
manifest = json.loads((ROOT / 'run-manifest.json').read_text())
rows = data['trials']
infrastructure = [r for r in rows if r.get('stopPaid')]
measured = [r for r in rows if not r.get('stopPaid')]
recoveries = [r for r in rows if r['trial'] > 3]
settled = [e for e in ledger if isinstance(e.get('reportedCostUsd'), (int, float)) and math.isfinite(e['reportedCostUsd']) and e['reportedCostUsd'] >= 0]
unknown_cost_count = len(ledger) - len(settled)
known_cost = sum(e['reportedCostUsd'] for e in settled)
cost = known_cost if not unknown_cost_count else None
unknown_reservations = sum(e['reservedUsd'] for e in ledger if e not in settled)
successes = sum(r['passed'] for r in measured)
prompt = sum((e.get('usage') or {}).get('prompt_tokens') or 0 for e in ledger)
completion = sum((e.get('usage') or {}).get('completion_tokens') or 0 for e in ledger)
cached = sum(((e.get('usage') or {}).get('prompt_tokens_details') or {}).get('cached_tokens') or 0 for e in ledger)
reasoning = sum(((e.get('usage') or {}).get('completion_tokens_details') or {}).get('reasoning_tokens') or 0 for e in ledger)
assert len(ledger) <= 80
assert len(ledger) * 0.125 <= 10
unverified_routing = sum(e.get('observedProvider') != 'fireworks' or (e.get('generationReceipt') or {}).get('model') != data['model'] for e in ledger)
tasks = collections.defaultdict(list)
for row in measured:
    tasks[row['task']].append(row)
table = []
for name in ['navigation', 'bug-repair', 'feature', 'multi-file', 'test-diagnosis']:
    group = tasks[name]
    active = [r['activeRuntimeMs'] / 1000 for r in group if 'activeRuntimeMs' in r]
    calls = sum(r['requests'] for r in group)
    table.append({'task': name, 'trials': len(group), 'successes': sum(r['passed'] for r in group), 'medianActiveSeconds': statistics.median(active) if active else None, 'requests': calls})
summary = {'attemptsIncludingInfrastructureStop': len(rows), 'infrastructureStops': len(infrastructure), 'measuredTrials': len(measured), 'successes': successes, 'observedAllAttemptPassRate': sum(r['passed'] for r in rows) / len(rows) if rows else None, 'observedMeasuredPassRate': successes / len(measured) if measured else None, 'requests': len(ledger), 'reportedCostUsd': cost, 'knownSettledCostUsd': known_cost, 'unknownCostRequests': unknown_cost_count, 'unverifiedRoutingRequests': unverified_routing, 'reportedCostPerSuccessUsd': cost / successes if cost is not None and successes else None, 'promptTokens': prompt, 'completionTokens': completion, 'cachedInputTokens': cached, 'reportedReasoningTokens': reasoning, 'conservativeCumulativeReservationsUsd': len(ledger) * 0.125, 'budgetUsd': 10, 'tasks': table, 'stopped': data['stopped']}
summary.update({'unknownCostReservationsUsd': unknown_reservations, 'settledPlusUnknownReservationsUsd': known_cost + unknown_reservations})
(ROOT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
price = f'${cost:.7f}' if cost is not None else 'unknown (not all requests reconciled)'
lines = [
    '# Robota / pinned model baseline', '',
    f'Generated at {datetime.now(timezone.utc).isoformat()}.', '',
    f'Observed result: **{successes}/{len(measured)} trials without a transport/accounting stop passed**. All-attempt result, retaining {len(infrastructure)} infrastructure stop(s): **{sum(r["passed"] for r in rows)}/{len(rows)}**. Total independently reconciled gateway charge: **{price}** across **{len(ledger)}** dispatched inference requests. Owner-approved ceiling: **US$10**.', '',
    f'Known settled charge: **${known_cost:.7f}**; unknown-cost requests: **{unknown_cost_count}** with **${unknown_reservations:.3f}** still reserved; known charges plus unresolved reservations: **${known_cost + unknown_reservations:.7f}**. Requests without a verified exact-model/pinned-provider receipt: {unverified_routing}. Reservations are conservative admission bounds, not bills; unknown charges are not treated as zero.', '',
    'This is a small synthetic coding baseline through Robota’s actual headless runtime, native chat-completions-compatible adapter and built-in file tools. It does not measure the TUI, installed release binary, full repository development, arbitrary shell execution, browser work, delegation, or comparative model quality.', '',
    '## Results', '',
    '| Task | Measured trials | Passed | Median active runtime | Dispatched requests |',
    '|---|---:|---:|---:|---:|',
]
for row in table:
    duration = f'{row["medianActiveSeconds"]:.2f}s' if row['medianActiveSeconds'] is not None else 'unmeasured'
    lines.append(f'| {row["task"]} | {row["trials"]} | {row["successes"]} | {duration} | {row["requests"]} |')
lines += [
    '', f'Usage including the failed first attempt: {prompt:,} prompt tokens ({cached:,} cached), {completion:,} completion tokens, {reasoning:,} reported reasoning tokens.', '',
    'Active runtime is the worker session elapsed time minus measured, serial gateway receipt-polling intervals. It includes provider generation, tool processing and the local relay; it is not pure inference latency. Full wall time also includes container startup, receipt ingestion delays and independent verification. Each trial JSON retains all timing categories.', '',
    'Success requires an uninterrupted completed run, actual tool use, independently correct candidate files, unchanged protected files and no unexpected project files. An agent saying “done” cannot pass the verifier. The hidden verifiers run in separate read-only, network-disabled Docker containers; candidate code is never executed on the host.', '',
    '## Infrastructure stops and recovery', '',
    'The initial navigation attempt stopped after one paid generation because the gateway’s asynchronously ingested receipt was not available within the original three-second polling window. The completion was not forwarded to Robota, so this is an infrastructure failure rather than evidence that the model could not navigate the project. Its original failed outcome, response and fixture remain in [navigation-1.json](navigation-1.json) and [navigation-1-wire.json](navigation-1-wire.json). A subsequent read-only lookup verified the exact requested snapshot on the pinned provider and a total charge of $0.0006927, including reporting-tag overhead; see [the original generation receipt](initial-generation-reconciliation.json). No unknown inference request was retried.', '',
    'The experiment consumer was corrected to wait up to 30 seconds for receipt ingestion, exclude that wait from its 90-second active deadline and performance metric, and preserve budget reservations/rows across resume. The original failed attempt remains in the overall attempt denominator; it was not overwritten with a success.', '',
    ('Recovery attempts recorded: ' + ', '.join(f'{r["task"]}-{r["trial"]} ({"pass" if r["passed"] else "fail"})' for r in recoveries) + '. Every outcome is retained under the same scoring rules.' if recoveries else 'No recovery attempt has been recorded; no replacement observation is claimed.'), '',
    'A second infrastructure stop occurred during navigation trial 3: the paid completion returned successfully, but a separate read-only receipt GET hit its five-second network timeout. The original failed row is retained in [navigation-3.json](navigation-3.json). A later GET reconciled its exact model/provider and $0.000338508 charge; see [the second reconciliation](second-generation-reconciliation.json). The consumer was corrected to retry only explicitly transient read-only lookup errors within the existing 30-second deadline, while TLS/auth/URL failures remain closed. Paid inference requests were never automatically retried. Recovery numbering was generalized to preserve both failed attempts and obtain the planned observation count without replacing outcome failures.', '',
    'Dispatch 53 received an explicit provider-capacity HTTP 429 during multi-file trial 3. No generation ID, usage or charge was captured on the error path. Its failed row and unknown charge remain unchanged. A reviewed manual resume exception names ordinal 53 and requires its exact recorded rejection shape, unchanged reservation and bounded request fields; other unsettled entries still block resume. The $0.125 reservation was retained, never released or relabeled as zero cost. No provider fallback was enabled.', '',
    'The experiment harness revisions differ. The original runner SHA256 was `89f1fabf57b454f1290b25d04fa1a0b46f541f99a1a0e2ccb620fba9d45ebd8f` and worker SHA256 was `e3313414664810d2125b7d4ad691a4027a1a99f50a793d8265b9ba8049081661`. Earlier resumed script/config/results are retained under [resume-1](harness-revisions/resume-1/run-manifest.json) and [resume-2](harness-revisions/resume-2/run-manifest.json); the latest resumed revision and exact Docker image digest are in [run-manifest.json](run-manifest.json). The product source revision did not change.', '',
    '## Conditions and spend accounting', '',
    '- Product source: `0f7d2147626674970290fe843c05a9e6e9e6ce05` (Robota 3.0.0-beta.94).',
    '- Model: pinned model and route (recorded as data in the evidence); single-provider routing, with no provider/model fallback.',
    '- Temperature 0.2; reasoning effort `high` requested; 8 turns; 8,192 maximum output tokens per request. Requested effort is recorded separately from observed reasoning usage.',
    '- Built-in Read, Write, Edit, Glob and Grep tools. Shell, network and delegation tools are not exposed; verifiers execute tests independently.',
    '- Independent fresh projects and HOME/product state. Non-root Docker containers have no network, a read-only image, dropped capabilities, bounded resources and only the synthetic fixture mounted writable. API authentication stays in the host relay and is never provided to the tested agent.',
    '- Every dispatch reserves $0.125 before network I/O; at most 80 dispatches and 160 KB of text-only request data. Actual source/catalog/provider/usage validation is recorded before further paid work.',
    '- All charges, failures and the recovery attempt count. Gateway generation receipts provide `total_cost`, including surcharge/reporting writes. Account-wide credit deltas are not treated as an attributable invoice.',
    '- Robota session `usage.costUsd` is a runtime estimate. This report uses independently reconciled gateway generation receipts for billed costs.',
    '- Trials use fresh project/session state but run serially through one provider; provider prompt-cache hits are retained. These are observed warm-cache costs, not a forced cold-cache price benchmark.',
    '',
    f'The cumulative conservative reservation was ${len(ledger) * 0.125:.3f}; **this is an upper-bound admission accounting value, not the amount billed**. The observed charge was {price}.', '',
    '## Evidence', '',
    '- [Summary](summary.json), [all trial outcomes](results.json), [paid dispatch ledger and generation receipts](ledger.json).',
    '- [Broken/solved and isolation controls](offline-controls.json), [request guards](request-guard-controls.json), [receipt guards](receipt-guard-controls.json), [offline real-runtime smoke](bug-repair-0.json).',
    '- [Current provider catalog](model-endpoints.json), [source/script/image manifest](run-manifest.json).',
    '- Full candidate file snapshots and SHA256 manifests are linked by each trial JSON under `fixtures/`. Git metadata and disposable runtime state are excluded. Symlinks are recorded without following them.',
    '- [Initial resumed log](live-resume.log), [second resumed log](live-resume-2.log), [latest resumed log](live-resume-3.log), [recovery controls](recovery-controls.json), [capacity admission controls](capacity-controls.json). No credential values are included in the report or model transcripts.', '',
    '## Reproduction', '',
    'Use a clean checkout of the pinned source revision and an existing authorized gateway key in the local repository environment file. The scripts read only one named credential variable. The Docker build copies tracked source files only, excluding credentials and the checkout’s node_modules.', '',
    '```sh', 'python3 build.py --source /absolute/path/to/clean/pinned/robota', 'python3 benchmark.py                 # offline controls and real-runtime replay; no paid calls', 'python3 benchmark.py --live          # refuses an existing live ledger', '```', '',
    'This evidence directory deliberately already contains a live ledger. Never delete or reset it to manufacture a fresh budget. A new series needs a separate results directory and an explicitly approved budget. `--live --resume` refuses unreconciled dispatches and skips recorded trials. The narrowly reviewed `--reserved-capacity-ordinal 53` exception preserves that exact rejection and its full reservation; it never bypasses other uncertainties or resets the cap.', '',
    '## Interpretation', '',
    'Up to three observations per small task are useful compatibility and regression evidence. They are insufficient to establish broad coding reliability, superiority to other models, long-horizon performance, or a production security guarantee. Infrastructure failures and the changed experiment revisions are explicitly retained. No product source changes, release or deployment were performed for this experiment.', '',
    'This baseline does not establish a single-agent-versus-delegation comparison.', '',
    'Cleanup observations are recorded in [cleanup.json](cleanup.json).',
]
if data['stopped']:
    lines.insert(4, '**Stopped early:** ' + data['stopped'])
(ROOT / 'README.md').write_text('\n'.join(lines) + '\n')
