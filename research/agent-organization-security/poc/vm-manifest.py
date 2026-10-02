"""Inspect owned QEMU processes/QMP and guest boundaries without cloud credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--vm-dir', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
directory = args.vm_dir.resolve()


def qmp(name):
    channel = socket.socket(socket.AF_UNIX)
    channel.settimeout(5)
    channel.connect(str(directory / (name + '-qmp.sock')))
    stream = channel.makefile('rwb')
    version = json.loads(stream.readline())['QMP']['version']
    result = {'version': version}
    for command in ['qmp_capabilities', 'query-kvm', 'query-status', 'query-block']:
        stream.write((json.dumps({'execute': command}) + '\n').encode())
        stream.flush()
        while True:
            reply = json.loads(stream.readline())
            if 'event' not in reply:
                break
        assert 'return' in reply, command
        result[command] = reply['return']
    channel.close()
    return result


class Canary(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'synthetic-network-positive-control')

    def log_message(self, *_):
        pass


server = ThreadingHTTPServer(('0.0.0.0', 0), Canary)
threading.Thread(target=server.serve_forever, daemon=True).start()
records = []
try:
    import urllib.request
    with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}', timeout=2) as response:
        assert response.read() == b'synthetic-network-positive-control'
    for name, port in [('worker-a', 22243), ('worker-b', 22244)]:
        pid = int((directory / (name + '.pid')).read_text())
        argv = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        argv = [item.decode() for item in argv if item]
        assert Path(argv[0]).name == 'qemu-system-x86_64'
        assert 'user,model=virtio-net-pci,restrict=on,hostfwd=tcp:127.0.0.1:' + str(port) + '-:22' in argv
        assert '-virtfs' not in argv and '-fsdev' not in argv and '-device' not in argv
        observed = qmp(name)
        assert observed['query-kvm'] == {'enabled': True, 'present': True}
        disks = [entry['inserted']['file'] for entry in observed['query-block'] if 'inserted' in entry]
        assert set(disks) == {str(directory / (name + '.qcow2')), str(directory / ('seed-' + name + '.iso'))}
        ssh = ['ssh', '-F', '/dev/null', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', f'UserKnownHostsFile={directory / "known_hosts"}', '-i', str(directory / 'poc_ed25519'),
               '-p', str(port), 'researcher@127.0.0.1']
        probe = f'''import json,socket,urllib.request
results=[]
for host,port in [('10.0.2.2',{server.server_port}),('169.254.169.254',80),('1.1.1.1',443)]:
 try:
  with socket.create_connection((host,port),timeout=2):
   results.append({{'host':host,'connected':True}})
 except OSError as error:
  results.append({{'host':host,'connected':False,'errorType':type(error).__name__,'errno':error.errno}})
print(json.dumps(results))
'''
        guest = subprocess.run(ssh + ['python3 -'], input=probe, capture_output=True, text=True, timeout=15)
        assert guest.returncode == 0, 'Guest Python probe failed'
        network = json.loads(guest.stdout)
        assert all(not item['connected'] for item in network), 'Unexpected direct guest connection'
        # Preserve the actual arguments with a portable directory placeholder.
        records.append({'name': name, 'qemuArguments': [item.replace(str(directory), '$TASK_VM_DIR') for item in argv],
                        'kvm': observed['query-kvm'], 'status': observed['query-status'],
                        'diskFiles': [Path(item).name for item in disks], 'network': network,
                        'hostCanaryPositiveControl': True, 'passed': True})
finally:
    server.shutdown()
    server.server_close()

hashes = {}
for name in ['runtime.qcow2', 'node-runtime.tar.gz', 'cli-deployed-artifact.tar.gz',
             'seed-worker-a/user-data', 'seed-worker-a/meta-data', 'seed-worker-b/user-data', 'seed-worker-b/meta-data']:
    with (directory / name).open('rb') as source:
        hashes[name] = hashlib.file_digest(source, 'sha256').hexdigest()
args.output.write_text(json.dumps({'kind': 'actual-local-kvm-configuration', 'records': records,
                                  'artifactSha256': hashes,
                                  'limitations': ['Three direct TCP destinations tested; this is not a provider DNS/egress policy result.',
                                                  'Guest VM escape and hardware side channels are not exhaustively tested.']}, indent=2) + '\n')
print(f'{len(records)} QMP/argv/network manifests verified')
