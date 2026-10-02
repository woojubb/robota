"""Cross-language signing regression over the actual Python and Node functions."""
import argparse
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

parser = argparse.ArgumentParser()
parser.add_argument('--node', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('research_broker', Path(__file__).with_name('organization-broker.py'))
broker = importlib.util.module_from_spec(spec); spec.loader.exec_module(broker)
key = Ed25519PrivateKey.generate()
vectors = [{'z': '한글', 'a': 'emoji😀'}, {'value': '\x00\n\r\t"\\'}, {'10': 1, '2': 2, 'a': {'z': True, 'a': None}},
           {'integer': 9007199254740991, 'negative': -5}, {'value': '\u2028\u2029'}, {'array': ['text', 1, False, None]}]
invalid = [{'value': 1.5}, {'value': 9007199254740992}, {'한글': 'invalid schema key'}, {'value': '\ud800'}]
script = '''import {canonical} from './research/agent-organization-security/poc/canonical-json.mjs';
import {readFileSync} from 'node:fs'; import {sign,createPrivateKey} from 'node:crypto';
const input=JSON.parse(readFileSync(0,'utf8')); const key=createPrivateKey(input.key);
const valid=input.vectors.map(v=>{const bytes=canonical(v);return {bytes,signature:sign(null,Buffer.from(bytes),key).toString('base64url')};});
const invalid=input.invalid.map(v=>{try{canonical(v);return false;}catch{return true;}});
process.stdout.write(JSON.stringify({valid,invalid}));'''
input_data = {'vectors': vectors, 'invalid': invalid, 'key': key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()}
result = subprocess.run([args.node, '--input-type=module', '-e', script], input=json.dumps(input_data),
                        capture_output=True, text=True, check=True)
node = json.loads(result.stdout)
records = []
for index, (value, observed) in enumerate(zip(vectors, node['valid'])):
    same = broker.canonical(value) == observed['bytes'].encode()
    key.public_key().verify(broker.unbase(observed['signature']), broker.canonical(value))
    records.append({'id': f'canonical-vector-{index}', 'sameBytes': same, 'nodeProofVerifiedByPython': True, 'passed': same})
for index, value in enumerate(invalid):
    try:
        broker.canonical(value)
        rejected = False
    except ValueError:
        rejected = True
    records.append({'id': f'invalid-domain-{index}', 'pythonRejected': rejected, 'nodeRejected': node['invalid'][index],
                    'passed': rejected and node['invalid'][index]})
args.output.write_text(json.dumps({'kind': 'cross-language-canonical-ed25519-regression', 'records': records}, indent=2) + '\n')
assert all(r['passed'] for r in records)
print(f'{len(records)} canonical/signing regressions passed')
