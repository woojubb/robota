#!/usr/bin/env python3
"""Owner-authorized US$10 single-agent baseline through the actual Robota headless runtime."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
import uuid

from tasks import TASKS

HERE = Path(__file__).resolve().parent
SOURCE = Path('<source-checkout>')
IMAGE = 'robota-deepseek-benchmark:20261021'
MODEL = 'deepseek/deepseek-v4.1-flash-1017'
URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'
TAG = 'robota-deepseek-baseline-20261021'
RESERVATION = 0.125
MAX_REQUESTS = 80
MAX_BODY = 160_000
LIMIT = 10.0
TEMP = HERE / '.temporary'
TEMP.mkdir(exist_ok=True)
COMMON = ['--label', 'robota.benchmark=20261021', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '1g', '--cpus', '2', '--user', '1000:1000', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=134217728']


def save(name, data):
    target = HERE / name
    temporary = target.with_suffix(target.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.replace(target)


def create_fixture(root, task, solved=False):
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o777)
    files = dict(task['files'])
    if solved:
        files.update(task['solved'])
    for relative, text in files.items():
        p = root / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.parent.chmod(0o777)
        p.write_text(text)
        p.chmod(0o666)


def verifier(root, code):
    name = 'robota-deepseek-verifier-' + uuid.uuid4().hex[:12]
    command = ['docker', 'run', '--rm', '--name', name, *COMMON, '-v', f'{root}:/work:ro', '-w', '/work', IMAGE, 'node', '--input-type=module', '-e', code]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=12)
        return {'passed': result.returncode == 0, 'exitCode': result.returncode, 'diagnostic': result.stderr[-1800:]}
    except subprocess.TimeoutExpired:
        return {'passed': False, 'exitCode': None, 'diagnostic': 'Verifier timed out'}
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True)


def offline_controls():
    records = []
    with tempfile.TemporaryDirectory(prefix='controls-', dir=TEMP) as directory:
        base = Path(directory)
        for task in TASKS:
            broken = base / (task['id'] + '-broken')
            solved = base / (task['id'] + '-solved')
            create_fixture(broken, task)
            create_fixture(solved, task, True)
            a, b = verifier(broken, task['verify']), verifier(solved, task['verify'])
            assert not a['passed'] and b['passed'], (task['id'], a, b)
            records.append({'task': task['id'], 'brokenRejected': True, 'solvedAccepted': True})
        canary = base / 'host-canary.txt'
        canary.write_text('not mounted into verifier')
        checks = """import fs from 'node:fs'; import net from 'node:net';
          let rejected=false; try { fs.readFileSync(process.argv[1]); } catch { rejected=true; }
          if(!rejected) throw Error('host absolute path exposed');
          try { fs.writeFileSync('/work/forbidden-write','x'); throw Error('readonly bypass'); } catch(e) {if(e.message==='readonly bypass') throw e;}
          await new Promise((resolve,reject)=>{ const s=net.connect({host:'1.1.1.1',port:443}); s.once('connect',()=>{s.destroy();reject(Error('network accessible'));}); s.once('error',()=>resolve()); s.setTimeout(1000,()=>{s.destroy();resolve();}); });
        """.replace('process.argv[1]', json.dumps(str(canary)))
        isolated = verifier(base / 'navigation-solved', checks)
        assert isolated['passed'], isolated
        records.append({'hostAbsolutePathDenied': True, 'networkDenied': True, 'fixtureReadOnly': True})
    save('offline-controls.json', records)
    print(json.dumps({'offlineControls': 'passed', 'count': len(records)}), flush=True)


def validate_request(message, dispatches):
    if dispatches >= MAX_REQUESTS or (dispatches + 1) * RESERVATION > LIMIT:
        raise ValueError('Aggregate US$10 conservative reservation ceiling reached')
    if message['url'] != URL:
        raise ValueError('Unexpected provider endpoint')
    body = message['body']
    if body.get('model') != MODEL:
        raise ValueError('Unexpected model or auxiliary model call')
    if body.get('stream'):
        raise ValueError('This experiment accepts non-streaming requests only')
    for entry in body.get('messages', []):
        content = entry.get('content')
        if content is not None and not isinstance(content, str):
            if not isinstance(content, list) or any(p.get('type') != 'text' for p in content):
                raise ValueError('Only text inputs are authorized')
    for tool in body.get('tools', []):
        if tool.get('type') != 'function':
            raise ValueError('Native paid tools are not authorized')
    # Model-visible tools are limited to the built-in local file tools.
    body['tools'] = [t for t in body.get('tools', []) if t['function']['name'] in ['Read', 'Write', 'Edit', 'Glob', 'Grep']]
    body['model'] = MODEL
    body['max_tokens'] = 8192
    body.pop('max_completion_tokens', None)
    body['temperature'] = 0.2
    body['stream'] = False
    body['reasoning'] = {'effort': 'high'}
    body['providerOptions'] = {'gateway': {'only': ['fireworks'], 'order': ['fireworks'], 'tags': [TAG]}}
    encoded = json.dumps(body).encode()
    if len(encoded) > MAX_BODY:
        raise ValueError('Request exceeds conservative text/token reservation bound')
    return encoded


def existing_key():
    # Read only the explicitly approved gateway credential; never copy it into the container or report.
    env = Path('<credential-env-file>')
    for line in env.read_text().splitlines():
        if line.startswith('AI_GATEWAY_API_KEY='):
            value = line.split('=', 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if value:
                return value
    raise RuntimeError('Existing Gateway credential unavailable')


def credits(key):
    try:
        req = urllib.request.Request('https://ai-gateway.vercel.sh/v1/credits', headers={'Authorization': 'Bearer ' + key})
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)
    except Exception as error:
        return {'unavailable': type(error).__name__}


def lookup_generation(key, generation_id):
    if not isinstance(generation_id, str) or not generation_id.startswith('gen_') or not generation_id.replace('_', '').isalnum():
        return None
    deadline = time.monotonic() + 30
    for attempt in range(16):
        if time.monotonic() >= deadline:
            break
        try:
            request = urllib.request.Request('https://ai-gateway.vercel.sh/v1/generation?id=' + generation_id, headers={'Authorization': 'Bearer ' + key})
            with urllib.request.urlopen(request, timeout=min(5, max(0.2, deadline - time.monotonic()))) as response:
                value = json.load(response)
            if isinstance(value.get('data'), dict):
                return value['data']
        except urllib.error.HTTPError as error:
            if error.code not in [404, 400]:
                raise
        if attempt < 15:
            time.sleep(min(2, max(0, deadline - time.monotonic())))
    return None


def validate_receipt(data, serving):
    usage = data.get('usage', {})
    if any(type(usage.get(k)) is not int or usage[k] < 0 for k in ['prompt_tokens', 'completion_tokens', 'total_tokens']):
        raise RuntimeError('Missing or invalid usage; halt paid dispatches')
    if usage['completion_tokens'] > 8192 or usage['prompt_tokens'] > MAX_BODY:
        raise RuntimeError('Provider exceeded token reservation bound')
    if serving != 'fireworks':
        raise RuntimeError('Serving provider unverified or mismatched; halt paid dispatches')
    if data.get('model') not in [MODEL, 'deepseek-v4.1-flash-1017']:
        raise RuntimeError('Returned model does not match the pinned snapshot')


def execute_trial(root, task, trial, ledger, key=None):
    create_fixture(root, task)
    name = f'robota-deepseek-{task["id"]}-{trial}'
    command = ['docker', 'run', '--rm', '-i', '--name', name, *COMMON, '-v', f'{root}:/work:rw', '-w', '/opt/robota', IMAGE]
    start = time.monotonic()
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write(json.dumps({'kind': 'init', 'prompt': task['prompt']}) + '\n')
    process.stdin.flush()
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, 'stdout')
    selector.register(process.stderr, selectors.EVENT_READ, 'stderr')
    result = None
    events, diagnostics = [], []
    calls_before = len(ledger)
    offline_step = 0
    accounting_total_ms = 0
    stop_paid = False
    try:
        while time.monotonic() - start - accounting_total_ms / 1000 < 90 and time.monotonic() - start < 360:
            ready = selector.select(timeout=1)
            if not ready and process.poll() is not None:
                break
            for stream, _ in ready:
                line = stream.fileobj.readline()
                if not line:
                    selector.unregister(stream.fileobj)
                    continue
                if not line.startswith('BENCH:'):
                    diagnostics.append(line[-1500:])
                    continue
                message = json.loads(line[6:])
                if message['kind'] == 'result':
                    result = message
                    continue
                if message['kind'] != 'request':
                    continue
                encoded = validate_request(message, len(ledger) if key else 0)
                if key:
                    active_remaining = 90 - (time.monotonic() - start - accounting_total_ms / 1000)
                    if active_remaining <= 0:
                        raise RuntimeError('Active trial time budget exhausted before dispatch')
                    entry = {'task': task['id'], 'trial': trial, 'ordinal': len(ledger) + 1, 'reservedUsd': RESERVATION, 'requestBytes': len(encoded), 'maxOutputTokens': 8192, 'status': 'dispatched'}
                    ledger.append(entry)
                    save('ledger.json', ledger)
                    request = urllib.request.Request(URL, data=encoded, headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}, method='POST')
                    sent = time.monotonic()
                    try:
                        with urllib.request.urlopen(request, timeout=min(60, active_remaining)) as response:
                            data = json.load(response)
                            status = response.status
                        entry.update({'status': status, 'latencyMs': (time.monotonic() - sent) * 1000, 'id': data.get('id'), 'model': data.get('model'), 'usage': data.get('usage'), 'providerMetadata': data.get('providerMetadata', data.get('provider_metadata')), 'responseFields': list(data)})
                        events.append({'request': json.loads(encoded), 'response': data})
                        metadata = data.get('providerMetadata', data.get('provider_metadata', {}))
                        gateway = metadata.get('gateway', {}) if isinstance(metadata, dict) else {}
                        routing = gateway.get('routing', {})
                        accounting_started = time.monotonic()
                        receipt = lookup_generation(key, data.get('generationId', data.get('id')))
                        entry['accountingWaitMs'] = (time.monotonic() - accounting_started) * 1000
                        accounting_total_ms += entry['accountingWaitMs']
                        entry['generationReceipt'] = receipt
                        serving = (receipt or {}).get('provider_name') or routing.get('finalProvider') or routing.get('provider') or gateway.get('provider') or data.get('provider')
                        entry['observedProvider'] = serving
                        validate_receipt(data, serving)
                        cost = (receipt or {}).get('total_cost', gateway.get('cost'))
                        if cost is not None:
                            cost = float(cost)
                            if not math.isfinite(cost) or cost < 0 or cost > RESERVATION:
                                raise RuntimeError('Reported charge exceeds reservation or is invalid')
                        entry['reportedCostUsd'] = cost
                    except Exception as error:
                        entry.update({'status': 'unknown-or-failed', 'error': type(error).__name__})
                        if isinstance(error, urllib.error.HTTPError):
                            entry['httpStatus'] = error.code
                            try:
                                detail = json.loads(error.read()).get('error', {})
                                entry['providerError'] = str(detail.get('message', detail.get('code', '')))[:1500].replace(key, '[REDACTED]')
                            except Exception:
                                pass
                        save('ledger.json', ledger)
                        raise RuntimeError('Provider request failed or accounting became uncertain; no retry') from None
                    save('ledger.json', ledger)
                else:
                    offline_step += 1
                    if offline_step == 1:
                        assistant = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'read_fixture', 'type': 'function', 'function': {'name': 'Read', 'arguments': json.dumps({'filePath': '/work/src/cart.mjs'})}}]}
                    elif offline_step == 2:
                        assistant = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'write_fixture', 'type': 'function', 'function': {'name': 'Write', 'arguments': json.dumps({'filePath': '/work/src/cart.mjs', 'content': task['solved']['src/cart.mjs']})}}]}
                    else:
                        assistant = {'role': 'assistant', 'content': 'Done'}
                    data = {'id': f'offline-{offline_step}', 'object': 'chat.completion', 'created': 1, 'model': MODEL, 'choices': [{'index': 0, 'message': assistant, 'finish_reason': 'tool_calls' if 'tool_calls' in assistant else 'stop'}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
                    status = 200
                process.stdin.write(json.dumps({'kind': 'reply', 'id': message['id'], 'status': status, 'body': data}) + '\n')
                process.stdin.flush()
            if result is not None:
                break
        if result is None:
            result = {'completed': False, 'error': 'Trial exited or exceeded wall deadline without a result'}
    except Exception as error:
        result = {'completed': False, 'error': str(error).replace(key, '[REDACTED]') if key else str(error)}
        stop_paid = key is not None
    finally:
        selector.close()
        if process.poll() is None:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
        process.wait(timeout=15)
    observed = verifier(root, task['verify'])
    unchanged = all((root / p).is_file() and not (root / p).is_symlink() and (root / p).resolve().is_relative_to(root.resolve()) and (root / p).read_text() == original for p, original in task['files'].items() if p not in task['allowed'])
    unexpected = [str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.relative_to(root).parts[0] not in ['.git', '.bench-state'] and str(p.relative_to(root)) not in set(task['files']) | set(task['allowed'])]
    unchanged = unchanged and not unexpected
    candidate = {}
    for relative in task['allowed']:
        p = root / relative
        if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root.resolve()):
            candidate[relative] = p.read_text()[:20000]
    row = {'task': task['id'], 'trial': trial, 'passed': bool(result.get('completed') and observed['passed'] and unchanged and result.get('tools')), 'result': result, 'verifier': observed, 'protectedFilesUnchanged': unchanged, 'elapsedMs': (time.monotonic() - start) * 1000, 'requests': len(ledger) - calls_before, 'candidate': candidate, 'diagnostics': diagnostics[-8:], 'stopPaid': stop_paid}
    snapshot = HERE / 'fixtures' / f'{task["id"]}-{trial}'
    snapshot.mkdir(parents=True, exist_ok=True)
    manifest = []
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if relative.parts[0] in ['.git', '.bench-state']:
            continue
        destination = snapshot / relative
        if file.is_symlink():
            manifest.append({'path': str(relative), 'symlink': os.readlink(file)})
        elif file.is_file() and file.resolve().is_relative_to(root.resolve()):
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, destination)
            manifest.append({'path': str(relative), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
    row['fixtureSnapshot'] = str(snapshot.relative_to(HERE))
    row['fixtureManifest'] = manifest
    row['unexpectedFiles'] = unexpected
    row['accountingWaitMs'] = accounting_total_ms
    row['activeRuntimeMs'] = max(0, result.get('elapsedMs', row['elapsedMs']) - accounting_total_ms)
    save(f'{task["id"]}-{trial}.json', row)
    save(f'{task["id"]}-{trial}-wire.json', events)
    print(json.dumps({k: row[k] for k in ['task', 'trial', 'passed', 'elapsedMs', 'requests']}), flush=True)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    offline_controls()
    ledger, rows = [], []
    if not args.live:
        with tempfile.TemporaryDirectory(prefix='offline-', dir=TEMP) as directory:
            row = execute_trial(Path(directory) / 'project', TASKS[1], 0, ledger)
            assert row['passed'], row
        return
    if (HERE / 'ledger.json').exists() and not args.resume:
        raise RuntimeError('Existing live ledger found; refuse to overwrite or reset the approved budget')
    if args.resume:
        ledger = json.loads((HERE / 'ledger.json').read_text())
        if any(e.get('status') != 200 or e.get('observedProvider') != 'fireworks' or e.get('reportedCostUsd') is None for e in ledger):
            raise RuntimeError('Previous dispatch remains unreconciled; no paid resume allowed')
        for trial in range(1, 5):
            for task in TASKS:
                existing = HERE / f'{task["id"]}-{trial}.json'
                if existing.exists():
                    rows.append(json.loads(existing.read_text()))
        known_rows = {(r['task'], r['trial']) for r in rows}
        if any((e['task'], e['trial']) not in known_rows for e in ledger):
            raise RuntimeError('Ledger dispatch without a trial row; refuse automatic replay')
    key = existing_key()
    before = credits(key)
    save('credits-resume-before.json' if args.resume else 'credits-before.json', before)
    if 'balance' not in before or float(before['balance']) < RESERVATION:
        raise RuntimeError('Existing Gateway balance cannot cover one conservative reservation')
    with urllib.request.urlopen('https://ai-gateway.vercel.sh/v1/models/' + MODEL + '/endpoints', timeout=20) as response:
        catalog = json.load(response)
    selected = [e for e in catalog['data']['endpoints'] if e.get('provider_name') == 'fireworks' and e.get('status') == 0]
    if not selected:
        raise RuntimeError('Pinned provider unavailable; no paid request made')
    for endpoint in selected:
        prices = [endpoint['pricing']] + [v['pricing'] for v in endpoint.get('inference_regions', [])]
        if any(float(v['prompt']) > 0.0000005 or float(v['completion']) > 0.0000025 for v in prices):
            raise RuntimeError('Current provider rates exceed the reviewed reservation basis')
    save('model-endpoints.json', catalog)
    save('run-manifest.json', {'sourceCommit': '0f7d2147626674970290fe843c05a9e6e9e6ce05', 'scriptSha256': {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in ['benchmark.py', 'worker.mts', 'tasks.py', 'Dockerfile']}, 'dockerImage': subprocess.check_output(['docker', 'image', 'inspect', IMAGE, '--format', '{{.Id}}'], text=True).strip(), 'resume': args.resume, 'priorDispatchCount': len(ledger), 'activeDeadlineSeconds': 90, 'hardDeadlineSeconds': 360, 'receiptPollSeconds': 30})
    failure = None
    try:
        with tempfile.TemporaryDirectory(prefix='live-', dir=TEMP) as directory:
            for trial in range(1, 4):
                for task in TASKS:
                    if any(r['task'] == task['id'] and r['trial'] == trial for r in rows):
                        continue
                    row = execute_trial(Path(directory) / f'{task["id"]}-{trial}', task, trial, ledger, key)
                    rows.append(row)
                    if row['stopPaid']:
                        raise RuntimeError(row['result'].get('error', 'Paid dispatches stopped'))
            # Retain the infrastructure-stopped first attempt and explicitly record one recovery retry.
            first = next((r for r in rows if r['task'] == 'navigation' and r['trial'] == 1), None)
            if args.resume and first and first['stopPaid'] and not first['passed'] and not any(r['task'] == 'navigation' and r['trial'] == 4 for r in rows):
                rows.append(execute_trial(Path(directory) / 'navigation-recovery-4', TASKS[0], 4, ledger, key))
    except Exception as error:
        failure = str(error).replace(key, '[REDACTED]')
        print(json.dumps({'stopped': failure}), flush=True)
    finally:
        after = credits(key)
        save('credits-after.json', after)
        save('results.json', {'model': MODEL, 'gateway': 'Vercel AI Gateway', 'providerAllowlist': ['fireworks'], 'reasoning': 'high', 'temperature': 0.2, 'sourceCommit': '0f7d2147626674970290fe843c05a9e6e9e6ce05', 'budgetUsd': LIMIT, 'reservedLiabilityUsd': len(ledger) * RESERVATION, 'requests': len(ledger), 'trials': rows, 'stopped': failure, 'temporaryProjectsRemoved': True, 'billingReconciliation': 'credits before/after may include unrelated account traffic; not an attributable invoice'})


if __name__ == '__main__':
    main()
