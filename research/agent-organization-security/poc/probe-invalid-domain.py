"""Ensure malformed research-broker requests are denied and safely audited."""
import argparse
import importlib.util
import json
import multiprocessing
from pathlib import Path
import socket
import tempfile
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('research_broker', Path(__file__).with_name('organization-broker.py'))
broker = importlib.util.module_from_spec(spec); spec.loader.exec_module(broker)
with tempfile.TemporaryDirectory(prefix='issue-2-denial-') as directory:
    directory = Path(directory); broker.initialize(directory)
    key = Ed25519PrivateKey.generate()
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
    process = multiprocessing.get_context('fork').Process(target=broker.broker_process,
        args=(directory, 19091, 19092, 'synthetic-non-secret', public))
    process.start()
    try:
        for _ in range(20):
            try:
                with socket.create_connection(('127.0.0.1', 19091), timeout=.2):
                    break
            except OSError:
                time.sleep(.1)
        records = []
        for name, value in [('fraction', 1.5), ('overflow', 9007199254740992), ('unicode-key', {'한글': 'invalid-schema'})]:
            request = Request('http://127.0.0.1:19091/apply', data=json.dumps({'operation': {'value': value}}).encode(),
                              headers={'Content-Type': 'application/json'})
            try:
                with urlopen(request, timeout=2):
                    raise AssertionError('Malformed request admitted')
            except HTTPError as error:
                result = json.load(error)
                records.append({'id': name, 'status': error.code, 'reason': result['reason'],
                                'passed': error.code == 403 and process.is_alive()})
        count = len((directory / 'audit.jsonl').read_text().splitlines())
        args.output.write_text(json.dumps({'kind': 'actual-research-broker-invalid-domain-http',
                                          'records': records, 'auditRecords': count}, indent=2) + '\n')
        assert all(record['passed'] for record in records) and count == 3
    finally:
        process.terminate(); process.join(5)
print('3 invalid-domain HTTP requests denied and safely audited')
