"""Research-only signed admission broker and independent idempotent effect service.

No production accounts, payment API or workload attestation. The controller provisions
synthetic identities; these endpoints deliberately use separate processes/databases.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import Request, urlopen
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def canonical(value):
    def validate(item):
        if item is None or type(item) is bool:
            return
        if type(item) is int and abs(item) <= 9007199254740991:
            return
        if type(item) is str and not any(0xD800 <= ord(char) <= 0xDFFF for char in item):
            return
        if type(item) is list:
            for child in item:
                validate(child)
            return
        if type(item) is dict and all(type(key) is str and key.isascii() for key in item):
            for child in item.values():
                validate(child)
            return
        raise ValueError('Outside canonical JSON accepted domain')
    validate(value)
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def unbase(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def envelope(value, public):
    public.verify(unbase(value['signature']), canonical(value['payload']))
    return value['payload']


def database(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def initialize(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with database(directory / 'broker.db') as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, payload TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS nonces(actor TEXT, nonce TEXT, PRIMARY KEY(actor,nonce));
        CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY, digest TEXT, actor TEXT, task TEXT, amount INTEGER, approval TEXT UNIQUE, status TEXT, receipt TEXT);
        CREATE TABLE IF NOT EXISTS state(task TEXT PRIMARY KEY, revision INTEGER, value TEXT, fence INTEGER);
        ''')
    with database(directory / 'effects.db') as db:
        db.execute('CREATE TABLE IF NOT EXISTS effects(key TEXT PRIMARY KEY, operation_key TEXT, digest TEXT, receipt TEXT)')


class Deny(Exception):
    def __init__(self, reason, status=403):
        self.reason, self.status = reason, status


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, code, value):
        payload = canonical(value)
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def body(self):
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= 16384:
            raise Deny('request-size', 413)
        return json.loads(self.rfile.read(size))


def effects_process(directory, port, secret, idempotent=True):
    class Effects(Handler):
        def do_POST(self):
            try:
                if self.path != '/effect' or self.headers.get('Authorization') != 'Bearer ' + secret:
                    raise Deny('upstream-authorization')
                operation = self.body()
                with database(Path(directory) / 'effects.db') as db:
                    db.execute('BEGIN IMMEDIATE')
                    old = db.execute('SELECT * FROM effects WHERE key=?', (operation['key'],)).fetchone() if idempotent else None
                    if old:
                        if old['digest'] != digest(operation):
                            raise Deny('upstream-key-conflict', 409)
                        receipt = json.loads(old['receipt'])
                    else:
                        transaction = operation['key'] if idempotent else str(uuid.uuid4())
                        receipt = {'transaction': 'synthetic-' + transaction, 'operationDigest': digest(operation)}
                        db.execute('INSERT INTO effects VALUES(?,?,?,?)', (transaction, operation['key'], digest(operation), canonical(receipt).decode()))
                self.respond(200, receipt)
            except Deny as error:
                self.respond(error.status, {'reason': error.reason})
            except (ValueError, KeyError):
                self.respond(400, {'reason': 'invalid-request'})
    ThreadingHTTPServer(('127.0.0.1', port), Effects).serve_forever()


def broker_process(directory, port, upstream_port, upstream_secret, issuer_hex, crash_key=None, provider_idempotent=True):
    directory = Path(directory)
    issuer = Ed25519PublicKey.from_public_bytes(bytes.fromhex(issuer_hex))
    lock = threading.Lock()

    def audit(event):
        # Only allowlisted metadata: no prompt, credential, request value or exception text.
        filename = directory / 'audit.jsonl'
        previous = '0' * 64
        sequence = 1
        if filename.exists():
            lines = filename.read_text().splitlines()
            if lines:
                last = json.loads(lines[-1])
                previous, sequence = last['hash'], last['sequence'] + 1
        record = {'sequence': sequence, 'previous': previous, 'event': event}
        record['hash'] = digest(record)
        with filename.open('a') as output:
            output.write(canonical(record).decode() + '\n')

    def authorize(db, request):
        grant = envelope(request['credential'], issuer)
        now = time.time()
        if grant['audience'] != 'organization-research-broker' or not grant['notBefore'] <= now < grant['expires']:
            raise Deny('audience-or-ttl')
        actor_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(grant['actorPublic']))
        proof = {key: request[key] for key in ['credential', 'operation', 'approval', 'nonce']}
        actor_key.verify(unbase(request['proof']), canonical(proof))
        operation = request['operation']
        if operation['task'] != grant['task'] or operation['action'] not in grant['actions'] or operation['resource'] not in grant['resources']:
            raise Deny('scope')
        ancestors = []
        current = grant
        while current:
            row = db.execute('SELECT * FROM grants WHERE id=?', (current['id'],)).fetchone()
            if not row or row['revoked'] or json.loads(row['payload']) != current:
                raise Deny('revoked-or-epoch')
            if current['audience'] != grant['audience'] or current['task'] != grant['task'] or not current['notBefore'] <= now < current['expires']:
                raise Deny('ancestor-scope-or-ttl')
            if operation['action'] not in current['actions'] or operation['resource'] not in current['resources']:
                raise Deny('ancestor-scope')
            ancestors.append(row)
            parent = current['parent']
            if parent:
                parent_row = db.execute('SELECT payload FROM grants WHERE id=?', (parent,)).fetchone()
                if not parent_row:
                    raise Deny('missing-parent')
                current = json.loads(parent_row['payload'])
            else:
                current = None
            if len(ancestors) > 8:
                raise Deny('delegation-depth')
        try:
            db.execute('INSERT INTO nonces VALUES(?,?)', (grant['actor'], request['nonce']))
        except sqlite3.IntegrityError:
            raise Deny('nonce-replay', 409)
        return grant, ancestors

    def apply(request):
        operation = request['operation']
        with database(directory / 'broker.db') as db:
            db.execute('BEGIN IMMEDIATE')
            grant, ancestors = authorize(db, request)
            if operation['action'] == 'state':
                row = db.execute('SELECT * FROM state WHERE task=?', (grant['task'],)).fetchone()
                revision = row['revision'] if row else 0
                fence = row['fence'] if row else 1
                if operation['revision'] != revision:
                    raise Deny('stale-revision', 409)
                if operation['fence'] != fence:
                    raise Deny('stale-fence', 409)
                db.execute('INSERT OR REPLACE INTO state VALUES(?,?,?,?)', (grant['task'], revision + 1, operation['value'], fence))
                return {'revision': revision + 1, 'fence': fence}
            if operation['action'] != 'charge' or type(operation['amount']) is not int or not 0 < operation['amount'] <= 100:
                raise Deny('invalid-operation')
            old = db.execute('SELECT * FROM operations WHERE key=?', (operation['key'],)).fetchone()
            if old and (old['digest'] != digest(operation) or old['actor'] != grant['actor'] or old['task'] != grant['task']):
                raise Deny('idempotency-conflict', 409)
            approval = envelope(request['approval'], issuer)
            if (approval['audience'] != 'organization-research-approval' or approval['actor'] != grant['actor']
                    or approval['task'] != grant['task'] or approval['epoch'] != grant['epoch']
                    or approval['operationDigest'] != digest(operation) or approval['expires'] <= time.time()):
                raise Deny('approval-binding')
            if not old:
                if any(row['used'] + operation['amount'] > json.loads(row['payload'])['budget'] for row in ancestors):
                    raise Deny('ancestor-budget', 429)
                for row in ancestors:
                    db.execute('UPDATE grants SET used=used+? WHERE id=?', (operation['amount'], row['id']))
                try:
                    db.execute('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?)',
                               (operation['key'], digest(operation), grant['actor'], grant['task'], operation['amount'], approval['id'], 'pending', None))
                except sqlite3.IntegrityError:
                    raise Deny('approval-reuse', 409)
            elif old['approval'] != approval['id']:
                raise Deny('approval-change', 409)
            elif old['status'] == 'complete':
                return json.loads(old['receipt'])
            elif not provider_idempotent:
                raise Deny('external-reconciliation-required', 503)
            db.commit()  # Durable reservation survives crash-before-ack; never refunded on an unknown result.
            upstream = Request(f'http://127.0.0.1:{upstream_port}/effect', data=canonical(operation),
                               headers={'Authorization': 'Bearer ' + upstream_secret, 'Content-Type': 'application/json'})
            with urlopen(upstream, timeout=2) as response:
                receipt = json.load(response)
            if operation['key'] == crash_key:
                os._exit(72)  # Deliberate process death after real independent side effect, before local acknowledgement.
            db.execute('UPDATE operations SET status=?,receipt=? WHERE key=?', ('complete', canonical(receipt).decode(), operation['key']))
            return receipt

    class Broker(Handler):
        def do_POST(self):
            if self.path != '/apply':
                self.respond(404, {'reason': 'no-such-endpoint'})
                return
            with lock:
                request = {}
                try:
                    request = self.body()
                    result = apply(request)
                    code = 200
                except Deny as error:
                    code, result = error.status, {'reason': error.reason}
                except Exception as error:
                    # Invalid signature and disconnected upstream are denied; raw exceptions may contain data.
                    from cryptography.exceptions import InvalidSignature
                    if isinstance(error, (ValueError, KeyError, TypeError, InvalidSignature)):
                        code, result = 403, {'reason': 'invalid-proof-or-schema'}
                    else:
                        code, result = 503, {'reason': 'operation-outcome-unknown'}
                try:
                    operation_digest = digest(request.get('operation', {}))
                except ValueError:
                    operation_digest = 'invalid-domain'
                audit({'code': code, 'reason': result.get('reason', 'admitted'),
                       'operationDigest': operation_digest})
                try:
                    self.respond(code, result)
                except (BrokenPipeError, ConnectionResetError):
                    pass
    ThreadingHTTPServer(('127.0.0.1', port), Broker).serve_forever()
