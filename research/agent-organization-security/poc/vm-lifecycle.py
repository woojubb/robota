"""Owned local VM filesystem/stop/resume/descendant/disk-restore observations."""
import argparse
import json
from pathlib import Path
import shutil
import socket
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--vm-dir', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
directory = args.vm_dir.resolve()
records = []


def ssh(port, command, timeout=10):
    return subprocess.run(['ssh', '-F', '/dev/null', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                           '-o', 'ConnectTimeout=2', '-o', f'UserKnownHostsFile={directory / "known_hosts"}',
                           '-i', str(directory / 'poc_ed25519'), '-p', str(port), 'researcher@127.0.0.1', command],
                          capture_output=True, text=True, timeout=timeout)


def qmp(command):
    with socket.socket(socket.AF_UNIX) as channel:
        channel.settimeout(5)
        channel.connect(str(directory / 'worker-a-qmp.sock'))
        stream = channel.makefile('rwb')
        json.loads(stream.readline())
        result = None
        for action in ['qmp_capabilities', command]:
            stream.write((json.dumps({'execute': action}) + '\n').encode()); stream.flush()
            while True:
                result = json.loads(stream.readline())
                if 'event' not in result:
                    break
            assert 'return' in result, action
        return result['return']


def record(name, expected, observed, passed):
    records.append({'id': name, 'expected': expected, 'observed': observed, 'passed': bool(passed)})
    args.output.write_text(json.dumps({'kind': 'actual-kvm-worker-lifecycle', 'records': records}, indent=2) + '\n')
    assert passed, name


pid = int((directory / 'worker-a.pid').read_text())
argv = [value.decode() for value in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0') if value]
assert Path(argv[0]).name == 'qemu-system-x86_64' and str(directory / 'worker-a.qcow2') in ' '.join(argv)
canary = directory / 'host-control-canary'
canary.write_text('synthetic-host-only-canary')
try:
    created = ssh(22243, 'printf task-a-only > /home/researcher/task-only.txt')
    own = ssh(22243, 'test "$(cat /home/researcher/task-only.txt)" = task-a-only')
    sibling = ssh(22244, 'test ! -e /home/researcher/task-only.txt')
    host = ssh(22243, 'test ! -e ' + str(canary))
    record('separate-task-and-host-filesystems', 'own write/read succeeds, same path absent in sibling and host path absent in guest',
           {'createExit': created.returncode, 'ownCheck': own.returncode, 'siblingCheck': sibling.returncode, 'hostCheck': host.returncode},
           all(r.returncode == 0 for r in [created, own, sibling, host]))
    qmp('stop')
    paused = qmp('query-status')
    start = time.monotonic()
    time.sleep(.3)
    qmp('cont')
    running = qmp('query-status')
    record('qmp-pause-resume', 'paused then running, guest still readable',
           {'paused': paused, 'running': running, 'durationMs': round((time.monotonic() - start) * 1000)},
           paused['status'] == 'paused' and running['running'] and ssh(22243, 'test -e /home/researcher/task-only.txt').returncode == 0)
    # A real parent/child pair in the guest. No host process is spawned by this fixture.
    code = "import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)','RESEARCH_VM_DESCENDANT']);writeFileSync('/home/researcher/descendant.pid',String(c.pid));setInterval(()=>{},1000)"
    remote = "nohup /home/researcher/node/bin/node --input-type=module -e " + "'" + code.replace("'", "'\\''") + "' > /home/researcher/descendant.log 2>&1 < /dev/null &"
    assert ssh(22243, remote).returncode == 0
    assert ssh(22243, "pgrep -f '[R]ESEARCH_VM_DESCENDANT' > /dev/null").returncode == 0
    # This external offline checkpoint contains state only; processes cannot survive power-off.
    assert ssh(22243, 'sudo poweroff').returncode in [0, 255]
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        cmdline = Path(f'/proc/{pid}/cmdline')
        if not cmdline.exists() or not cmdline.read_bytes():
            break
        time.sleep(.2)
    else:
        raise AssertionError('Owned QEMU failed to exit after poweroff')
    checkpoint = directory / 'worker-a-offline-checkpoint.qcow2'
    shutil.copy2(directory / 'worker-a.qcow2', checkpoint)

    def boot():
        for suffix in ['.pid', '-qmp.sock']:
            (directory / ('worker-a' + suffix)).unlink(missing_ok=True)
        log = (directory / 'worker-a-restart.log').open('ab')
        process = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=log)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            assert process.poll() is None, 'QEMU launch failed'
            try:
                if ssh(22243, 'true', timeout=3).returncode == 0:
                    return process
            except subprocess.TimeoutExpired:
                pass
            time.sleep(.3)
        raise AssertionError('Restored guest did not become ready')

    process = boot()
    assert ssh(22243, 'printf changed > /home/researcher/task-only.txt').returncode == 0
    assert ssh(22243, 'test "$(cat /home/researcher/task-only.txt)" = changed').returncode == 0
    assert ssh(22243, 'sudo poweroff').returncode in [0, 255]
    process.wait(timeout=60)
    shutil.copy2(checkpoint, directory / 'worker-a.qcow2')
    start = time.monotonic()
    process = boot()
    restored = ssh(22243, 'test "$(cat /home/researcher/task-only.txt)" = task-a-only')
    child_gone = ssh(22243, "! pgrep -f '[R]ESEARCH_VM_DESCENDANT' > /dev/null")
    record('offline-disk-checkpoint-restore-and-descendant-death', 'old filesystem restored, no parent/child process resumes',
           {'restoreDurationMs': round((time.monotonic() - start) * 1000), 'restoredCheckExit': restored.returncode, 'descendantAbsenceExit': child_gone.returncode},
           restored.returncode == 0 and child_gone.returncode == 0)
    # End with the owned guest stopped. worker-b cleanup is performed by the driver separately.
    assert ssh(22243, 'sudo poweroff').returncode in [0, 255]
    process.wait(timeout=60)
    record('owned-vm-cleanup', 'QEMU stopped and SSH unavailable', {'exitCode': process.returncode, 'sshExit': ssh(22243, 'true').returncode},
           process.returncode == 0 and ssh(22243, 'true').returncode != 0)
    checkpoint.unlink()
finally:
    canary.unlink(missing_ok=True)
args.output.write_text(json.dumps({'kind': 'actual-kvm-worker-lifecycle', 'records': records,
    'limitations': ['Disk checkpoint and saved-credential revocation are independently tested, not a single production resume flow.',
                    'Offline disk restore does not resume memory, connections or sessions.',
                    'Three short observations do not establish long-running reliability or provider cleanup/cost.']}, indent=2) + '\n')
print(f'{len(records)} actual VM lifecycle observations passed')
