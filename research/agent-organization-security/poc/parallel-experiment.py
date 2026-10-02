"""Actual two-guest signed/budget/approval/retry/revocation research experiment.

Requires already owned VMs from vm-recipe.md and cryptography in controller Python.
All signing/upstream keys are fresh synthetic fixtures. Reports contain no keys.
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import multiprocessing
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import uuid
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

spec = importlib.util.spec_from_file_location('research_broker', Path(__file__).with_name('organization-broker.py'))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)
parser = argparse.ArgumentParser()
parser.add_argument('--vm-dir', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--with-vm-recovery', action='store_true')
args = parser.parse_args()
directory = args.vm_dir.resolve()
context = multiprocessing.get_context('fork')
records, processes, tunnels = [], [], []
issuer = Ed25519PrivateKey.generate()
issuer_public = issuer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
upstream_secret = secrets.token_urlsafe(32)
secret_canary = secrets.token_urlsafe(32)
keys = {actor: Ed25519PrivateKey.generate() for actor in ['actor-a', 'actor-b', 'controller']}
credentials = {}
ports = {'actor-a': 22243, 'actor-b': 22244}


def signed(payload):
    return {'payload': payload, 'signature': base64.urlsafe_b64encode(issuer.sign(broker.canonical(payload))).decode().rstrip('=')}


def ssh(actor):
    return ['ssh', '-F', '/dev/null', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', f'UserKnownHostsFile={directory / "known_hosts"}', '-i', str(directory / 'poc_ed25519'),
            '-p', str(ports[actor]), 'researcher@127.0.0.1']


def ready(port):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.2):
                return
        except OSError:
            time.sleep(.1)
    raise AssertionError('Owned service did not become ready')


def start_broker(crash_key=None, provider_idempotent=True):
    process = context.Process(target=broker.broker_process,
                              args=(control, 19091, 19092, upstream_secret, issuer_public, crash_key, provider_idempotent))
    process.start()
    processes.append(process)
    ready(19091)
    return process


def grant(identifier, actor, parent=None, budget=100, ttl=600, task='task-shared', epoch=1):
    payload = {'id': identifier, 'actor': actor, 'actorPublic': keys[actor].public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex(), 'task': task, 'role': 'synthetic-worker',
        'audience': 'organization-research-broker', 'actions': ['charge', 'state'], 'resources': ['synthetic-asset'],
        'notBefore': int(time.time()) - 10, 'expires': int(time.time()) + ttl, 'parent': parent, 'budget': budget, 'epoch': epoch}
    with broker.database(control / 'broker.db') as db:
        if parent:
            ancestor = json.loads(db.execute('SELECT payload FROM grants WHERE id=?', (parent,)).fetchone()['payload'])
            assert budget <= ancestor['budget'] and payload['expires'] <= ancestor['expires']
            assert set(payload['actions']) <= set(ancestor['actions']) and set(payload['resources']) <= set(ancestor['resources'])
            assert task == ancestor['task']
        db.execute('INSERT INTO grants(id,payload) VALUES(?,?)', (identifier, broker.canonical(payload).decode()))
    result = signed(payload)
    credentials[identifier] = result
    return result


def operation(key, amount=10, task='task-shared', **extra):
    return {'key': key, 'action': 'charge', 'resource': 'synthetic-asset', 'task': task, 'amount': amount, **extra}


def approve(actor, op, approval_id=None, epoch=1):
    return signed({'id': approval_id or str(uuid.uuid4()), 'audience': 'organization-research-approval',
                   'actor': actor, 'task': op['task'], 'epoch': epoch, 'operationDigest': broker.digest(op), 'expires': int(time.time()) + 600})


def job(actor, request, credential=None):
    identifier = uuid.uuid4().hex
    path = control / (identifier + '.json')
    path.write_text(json.dumps({'actorPrivate': keys[actor].private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode(),
        'credential': credential or credentials[actor], 'requests': request}))
    path.chmod(0o600)
    # A unique per-request file avoids sharing/overwriting credentials during parallel SSH requests.
    remote_path = '/home/researcher/research-' + identifier + '.json'
    copy = ['scp', '-F', '/dev/null', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', f'UserKnownHostsFile={directory / "known_hosts"}', '-i', str(directory / 'poc_ed25519'),
            '-P', str(ports[actor]), str(path), 'researcher@127.0.0.1:' + remote_path]
    subprocess.run(copy, check=True, capture_output=True, timeout=10)
    result = subprocess.run(ssh(actor) + [f'/home/researcher/node/bin/node /home/researcher/guest-broker-client.mjs {remote_path}; TASK_JOB_EXIT=$?; rm -f {remote_path}; exit "$TASK_JOB_EXIT"'],
                            capture_output=True, text=True, timeout=15)
    path.unlink()
    assert result.returncode == 0, 'Guest client execution failed'
    return json.loads(result.stdout)


def record(name, expected, observed, passed):
    records.append({'id': name, 'expected': expected, 'observed': observed, 'passed': bool(passed)})
    args.output.write_text(json.dumps({'kind': 'actual-two-kvm-worker-organization-policy-poc', 'records': records, 'complete': False}, indent=2) + '\n')
    assert passed, name


def effect_count(key=None):
    with broker.database(control / 'effects.db') as db:
        return db.execute('SELECT COUNT(*) FROM effects' + (' WHERE operation_key=?' if key else ''), (key,) if key else ()).fetchone()[0]


def stop_command(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


with tempfile.TemporaryDirectory(prefix='issue-2-control-', dir=directory) as temporary:
    control = Path(temporary)
    broker.initialize(control)
    upstream = context.Process(target=broker.effects_process, args=(control, 19092, upstream_secret))
    upstream.start()
    processes.append(upstream)
    ready(19092)
    server = start_broker()
    try:
        grant('root', 'controller', ttl=1000)
        grant('actor-a', 'actor-a', 'root', ttl=600)
        grant('actor-b', 'actor-b', 'root', ttl=600)
        grant('expired', 'actor-a', 'root', ttl=-1)
        for actor in ports:
            copy = ['scp', '-F', '/dev/null', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                    '-o', f'UserKnownHostsFile={directory / "known_hosts"}', '-i', str(directory / 'poc_ed25519'),
                    '-P', str(ports[actor]), str(Path(__file__).with_name('guest-broker-client.mjs')), str(Path(__file__).with_name('canonical-json.mjs')), 'researcher@127.0.0.1:/home/researcher/']
            subprocess.run(copy, check=True, capture_output=True, timeout=10)
            tunnel = subprocess.Popen(ssh(actor)[:-1] + ['-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:19090:127.0.0.1:19091', ssh(actor)[-1]],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            tunnels.append(tunnel)
        time.sleep(.5)
        assert all(t.poll() is None for t in tunnels)
        for name, credential, request in [
            ('cross-task', None, {'operation': operation('cross', task='other-task')}),
            ('actor-impersonation', None, {'operation': operation('impersonation'), 'credentialOverride': credentials['actor-b']}),
            ('unsigned-proof', None, {'operation': operation('unsigned'), 'corruptProof': True}),
            ('expired-identity', credentials['expired'], {'operation': operation('expired')}),
            ('approval-missing', None, {'operation': operation('unapproved')}),
            ('management-api-inaccessible', None, {'operation': operation('admin'), 'path': '/admin'}),
        ]:
            result = job('actor-a', [request], credential)[0]
            record(name, 'denied with no external effect', result, result['status'] in [403, 404] and effect_count() == 0)
        a, b = operation('sibling-a', 60), operation('sibling-b', 60)
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(job, actor, [{'operation': op, 'approval': approve(actor, op)}]) for actor, op in [('actor-a', a), ('actor-b', b)]]
            results = [future.result()[0] for future in futures]
        with broker.database(control / 'broker.db') as db:
            used = db.execute('SELECT used FROM grants WHERE id=?', ('root',)).fetchone()[0]
        record('sibling-ancestor-budget-race', 'one admitted, one 429; aggregate parent use 60 of 100',
               {'statuses': sorted(item['status'] for item in results), 'parentUsed': used, 'effects': effect_count()},
               sorted(item['status'] for item in results) == [200, 429] and used == 60 and effect_count() == 1)
        op = operation('concurrent-duplicate', 10)
        approval = approve('actor-a', op)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda _: job('actor-a', [{'operation': op, 'approval': approval}])[0], range(2)))
        record('parallel-idempotent-external-effect', 'two matching receipts, exactly one surrogate transaction',
               {'statuses': [r['status'] for r in results], 'effects': effect_count(op['key'])},
               all(r['status'] == 200 for r in results) and results[0]['result'] == results[1]['result'] and effect_count(op['key']) == 1)
        altered = {**op, 'amount': 11}
        result = job('actor-a', [{'operation': altered, 'approval': approval}])[0]
        record('idempotency-argument-conflict', '409 and no second effect', result, result['status'] == 409 and effect_count(op['key']) == 1)
        tampered = operation('approval-tamper', 10)
        result = job('actor-a', [{'operation': {**tampered, 'amount': 11}, 'approval': approve('actor-a', tampered)}])[0]
        record('approval-argument-binding', '403, no effect', result, result['status'] == 403 and effect_count(tampered['key']) == 0)
        actor_op = operation('approval-wrong-actor', 1)
        result = job('actor-b', [{'operation': actor_op, 'approval': approve('actor-a', actor_op)}])[0]
        record('approval-actor-binding', '403/approval-binding for unused key, no effect', result, result['status'] == 403 and result['result']['reason'] == 'approval-binding' and effect_count(actor_op['key']) == 0)
        reuse = operation('approval-reuse', 1)
        result = job('actor-a', [{'operation': reuse, 'approval': approve('actor-a', reuse, approval['payload']['id'])}])[0]
        record('approval-single-use', '409 even if trusted issuer accidentally rebinds approval ID', result, result['status'] == 409 and effect_count(reuse['key']) == 0)
        nonce = uuid.uuid4().hex
        results = job('actor-a', [{'operation': op, 'approval': approval, 'nonce': nonce}] * 2)
        record('signed-request-replay', 'first receipt 200, replay nonce 409', [r['status'] for r in results], [r['status'] for r in results] == [200, 409])
        state = {'key': 'state', 'action': 'state', 'resource': 'synthetic-asset', 'task': 'task-shared', 'revision': 0, 'fence': 1, 'value': '한글·emoji😀·control\n' + secret_canary}
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda actor: job(actor, [{'operation': state}])[0], ports))
        record('parallel-shared-state-cas', 'one revision accepted, one stale writer rejected', sorted(r['status'] for r in results), sorted(r['status'] for r in results) == [200, 409])
        with broker.database(control / 'broker.db') as db:
            db.execute('UPDATE state SET fence=fence+1 WHERE task=?', ('task-shared',))
        result = job('actor-a', [{'operation': {**state, 'revision': 1}}])[0]
        record('expired-lease-fencing', '409 for old fence with correct revision', result, result['status'] == 409 and result['result']['reason'] == 'stale-fence')
        server.terminate(); server.join(5)
        crash_op = operation('crash-after-effect', 5)
        crash_approval = approve('actor-a', crash_op)
        server = start_broker(crash_op['key'])
        result = job('actor-a', [{'operation': crash_op, 'approval': crash_approval}])[0]
        server.join(5)
        with broker.database(control / 'broker.db') as db:
            pending = db.execute('SELECT status FROM operations WHERE key=?', (crash_op['key'],)).fetchone()['status']
        record('crash-after-external-effect-before-ack', 'process exit 72, connection lost, durable pending and one external effect',
               {'exit': server.exitcode, 'status': result['status'], 'journalStatus': pending, 'effects': effect_count(crash_op['key'])},
               server.exitcode == 72 and result['status'] == 0 and pending == 'pending' and effect_count(crash_op['key']) == 1)
        server = start_broker()
        result = job('actor-a', [{'operation': crash_op, 'approval': crash_approval}])[0]
        with broker.database(control / 'broker.db') as db:
            used = db.execute('SELECT used FROM grants WHERE id=?', ('root',)).fetchone()['used']
        record('restart-reconcile-idempotent-provider', 'same external receipt, no duplicate charge/reservation',
               {'status': result['status'], 'effects': effect_count(crash_op['key']), 'parentUsed': used},
               result['status'] == 200 and effect_count(crash_op['key']) == 1 and used == 75)
        # The second external service deliberately offers no idempotency guarantee.
        server.terminate(); server.join(5)
        upstream.terminate(); upstream.join(5)
        upstream = context.Process(target=broker.effects_process, args=(control, 19092, upstream_secret, False))
        upstream.start(); processes.append(upstream); ready(19092)
        unknown_op = operation('non-idempotent-unknown', 5)
        unknown_approval = approve('actor-a', unknown_op)
        server = start_broker(unknown_op['key'], provider_idempotent=False)
        lost = job('actor-a', [{'operation': unknown_op, 'approval': unknown_approval}])[0]
        server.join(5)
        server = start_broker(provider_idempotent=False)
        denied = job('actor-a', [{'operation': unknown_op, 'approval': unknown_approval}])[0]
        with broker.database(control / 'broker.db') as db:
            status = db.execute('SELECT status FROM operations WHERE key=?', (unknown_op['key'],)).fetchone()['status']
            used = db.execute('SELECT used FROM grants WHERE id=?', ('root',)).fetchone()['used']
        record('non-idempotent-unknown-requires-owner', 'lost response retains reservation and denies automatic reissue',
               {'initialStatus': lost['status'], 'retry': denied, 'effects': effect_count(unknown_op['key']), 'journalStatus': status, 'parentUsed': used},
               lost['status'] == 0 and denied['status'] == 503 and denied['result']['reason'] == 'external-reconciliation-required'
               and effect_count(unknown_op['key']) == 1 and status == 'pending' and used == 80)
        # A trusted asset owner looks up the external receipt; the worker cannot perform this DB write.
        with broker.database(control / 'effects.db') as external:
            external_receipt = external.execute('SELECT receipt,digest FROM effects WHERE operation_key=?', (unknown_op['key'],)).fetchone()
        assert external_receipt['digest'] == broker.digest(unknown_op)
        with broker.database(control / 'broker.db') as db:
            db.execute('UPDATE operations SET status=?,receipt=? WHERE key=?', ('complete', external_receipt['receipt'], unknown_op['key']))
        reconciled = job('actor-a', [{'operation': unknown_op, 'approval': unknown_approval}])[0]
        record('trusted-owner-external-reconciliation', 'owner receipt returns without a second non-idempotent effect',
               {'status': reconciled['status'], 'effects': effect_count(unknown_op['key'])},
               reconciled['status'] == 200 and effect_count(unknown_op['key']) == 1)
        # Save old worker identity, then revoke outside worker storage. Reusing the saved credential is a
        # credential-rollback test; the separate VM disk restore test is recorded elsewhere.
        old_credential = json.loads(json.dumps(credentials['actor-a']))
        recovered_process = None
        def revoke_actor():
            with broker.database(control / 'broker.db') as db:
                db.execute('UPDATE grants SET revoked=1 WHERE id=?', ('actor-a',))
        if args.with_vm_recovery:
            recovery_spec = importlib.util.spec_from_file_location('worker_recovery', Path(__file__).with_name('worker-recovery.py'))
            recovery = importlib.util.module_from_spec(recovery_spec); recovery_spec.loader.exec_module(recovery)
            saved_job = {'actorPrivate': keys['actor-a'].private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode(),
                'credential': old_credential, 'requests': [{'operation': op, 'approval': approval}]}
            def connect_recovery():
                connected = subprocess.Popen(ssh('actor-a')[:-1] + ['-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:19090:127.0.0.1:19091', ssh('actor-a')[-1]],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                tunnels.append(connected); time.sleep(.3)
                assert connected.poll() is None
                return connected
            observations, recovered_process = recovery.recover_worker(directory, control, ssh('actor-a'), saved_job, revoke_actor, connect_recovery)
            # Both old reverse forwards died with the VM, so establish one for the restored worker.
            tunnels[0].wait(timeout=5)
            tunnel = subprocess.Popen(ssh('actor-a')[:-1] + ['-o', 'ExitOnForwardFailure=yes', '-N', '-R', '127.0.0.1:19090:127.0.0.1:19091', ssh('actor-a')[-1]],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            tunnels.append(tunnel); time.sleep(.3)
            assert tunnel.poll() is None
            restored = subprocess.run(ssh('actor-a') + ['/home/researcher/node/bin/node /home/researcher/guest-broker-client.mjs /home/researcher/rollback-job.json'],
                                      capture_output=True, text=True, timeout=10)
            old_result = json.loads(restored.stdout)[0]
            record('integrated-revoke-stop-disk-restore', 'real saved identity restored but denied; descendant stopped and control journal retained',
                   {**observations, 'restoredIdentityRequest': old_result},
                   restored.returncode == 0 and old_result['status'] == 403 and old_result['result']['reason'] == 'revoked-or-epoch')
            keys['actor-a'] = Ed25519PrivateKey.generate()
            new_identity = grant('actor-a-v2', 'actor-a', 'root', ttl=300, epoch=2)
            recovery_op = operation('after-verified-recovery', 1)
            recovery_result = job('actor-a', [{'operation': recovery_op, 'approval': approve('actor-a', recovery_op, epoch=2)}], new_identity)[0]
            with broker.database(control / 'broker.db') as db:
                current_used = db.execute('SELECT used FROM grants WHERE id=?', ('root',)).fetchone()['used']
            record('fresh-identity-with-current-journal', 'new scoped key/epoch admitted, parent use continues at 81 rather than snapshot rollback',
                   {'status': recovery_result['status'], 'parentUsed': current_used, 'effects': effect_count(recovery_op['key'])},
                   recovery_result['status'] == 200 and current_used == 81 and effect_count(recovery_op['key']) == 1)
            assert subprocess.run(ssh('actor-a') + ['rm -f /home/researcher/rollback-job.json'], capture_output=True, timeout=10).returncode == 0
        else:
            revoke_actor()
        result = job('actor-a', [{'operation': op, 'approval': approval}], old_credential)[0] if not args.with_vm_recovery else old_result
        record('revoked-saved-identity', '403 even for previously complete operation after broker restart', result,
               result['status'] == 403 and result['result']['reason'] == 'revoked-or-epoch')
        with broker.database(control / 'broker.db') as db:
            db.execute('UPDATE grants SET revoked=1 WHERE id=?', ('root',))
        result = job('actor-b', [{'operation': operation('after-global-stop'), 'approval': approve('actor-b', operation('after-global-stop'))}])[0]
        record('ancestor-emergency-admission-stop', '403 descendants denied', result, result['status'] == 403)
        audit_lines = (control / 'audit.jsonl').read_text().splitlines()
        anchor = json.loads(audit_lines[-1])['hash']  # Held by controller outside workers and broker restart state.
        def valid(lines):
            previous = '0' * 64
            for sequence, line in enumerate(lines, 1):
                entry = json.loads(line)
                claimed = entry.pop('hash')
                if entry['sequence'] != sequence or entry['previous'] != previous or broker.digest(entry) != claimed:
                    return False
                previous = claimed
            return previous == anchor
        changed = json.loads(audit_lines[0]); changed['event']['code'] = 200
        altered_lines = [json.dumps(changed)] + audit_lines[1:]
        record('audit-redaction-and-anchor-validation', 'canary/key absent; mutation/deletion/reordering rejected against independent anchor',
               {'valid': valid(audit_lines), 'mutationRejected': not valid(altered_lines), 'deletionRejected': not valid(audit_lines[:-1]),
                'reorderRejected': not valid(list(reversed(audit_lines))), 'canaryAbsent': secret_canary not in '\n'.join(audit_lines),
                'upstreamKeyAbsent': upstream_secret not in '\n'.join(audit_lines)},
               valid(audit_lines) and not valid(altered_lines) and not valid(audit_lines[:-1]) and not valid(list(reversed(audit_lines)))
               and secret_canary not in '\n'.join(audit_lines) and upstream_secret not in '\n'.join(audit_lines))
    finally:
        cleanup_errors = []
        if 'recovered_process' in locals() and recovered_process is not None and recovered_process.poll() is None:
            try:
                try:
                    subprocess.run(ssh('actor-a') + ['sudo poweroff'], capture_output=True, timeout=10)
                    recovered_process.wait(timeout=60)
                finally:
                    stop_command(recovered_process)
            except Exception as error:
                cleanup_errors.append('restored-worker:' + type(error).__name__)
        for tunnel in tunnels:
            try:
                try:
                    stop_command(tunnel)
                finally:
                    if tunnel.stderr: tunnel.stderr.close()
            except Exception as error:
                cleanup_errors.append('ssh-tunnel:' + type(error).__name__)
        for process in reversed(processes):
            try:
                if process.is_alive(): process.terminate()
                process.join(timeout=5)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=5)
                if process.is_alive():
                    raise RuntimeError('Owned service did not stop')
            except Exception as error:
                cleanup_errors.append('control-service:' + type(error).__name__)
        if cleanup_errors:
            raise RuntimeError('Owned cleanup encountered failures after attempting every resource: ' + ','.join(cleanup_errors))
    args.output.write_text(json.dumps({'kind': 'actual-two-kvm-worker-organization-policy-poc', 'records': records,
        'cleanup': {'controlProcessesStopped': all(not p.is_alive() for p in processes), 'sshTunnelsStopped': all(t.poll() is not None for t in tunnels)},
        'limitations': ['Research broker is not integrated into production CLI or backed by workload attestation/KMS.',
                        'Charges are independent synthetic external effects, not a real payment provider.',
                        'Integrated local worker disk restore was enabled.' if args.with_vm_recovery else 'VM disk restore is a separate experiment unless --with-vm-recovery is enabled.',
                        'Money ledger race is tested; token, CPU, time and tenant-wide limits are not implemented by this prototype.',
                        'Controller anchor survives broker restart; independent remote audit service and controller compromise remain untested.']}, indent=2) + '\n')
print(f'{len(records)} two-guest organization experiments passed')
