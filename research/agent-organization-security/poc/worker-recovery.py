"""Owned offline worker-disk recovery; broker/issuer/journal remain outside snapshot."""
import hashlib
import json
from pathlib import Path
import shutil
import shlex
import subprocess
import time


def recover_worker(directory, control, ssh_args, saved_job, revoke, connect):
    directory = Path(directory)
    actor_file = control / 'saved-worker-job.json'
    actor_file.write_text(json.dumps(saved_job))
    actor_file.chmod(0o600)
    # Derive SCP options from the observed owned SSH invocation, not from ambient SSH configuration.
    scp = ['scp'] + ssh_args[1:-1]
    scp[scp.index('-p')] = '-P'
    subprocess.run(scp + [str(actor_file), 'researcher@127.0.0.1:/home/researcher/rollback-job.json'],
                   check=True, capture_output=True, timeout=10)

    def remote(command, timeout=10):
        return subprocess.run(ssh_args + [command], capture_output=True, text=True, timeout=timeout)

    before = remote('/home/researcher/node/bin/node /home/researcher/guest-broker-client.mjs /home/researcher/rollback-job.json')
    assert before.returncode == 0 and json.loads(before.stdout)[0]['status'] == 200
    pid = int((directory / 'worker-a.pid').read_text())
    argv = [value.decode() for value in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0') if value]
    assert Path(argv[0]).name == 'qemu-system-x86_64'
    assert 'file=' + str(directory / 'worker-a.qcow2') + ',if=virtio,format=qcow2' in argv
    spawned = []
    checkpoint = control / 'worker-a-checkpoint.qcow2'

    def stopped(process_id):
        result = remote('sudo poweroff')
        assert result.returncode in [0, 255]
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            cmdline = Path(f'/proc/{process_id}/cmdline')
            if not cmdline.exists() or not cmdline.read_bytes():
                return
            time.sleep(.2)
        raise AssertionError('Owned QEMU did not stop; no disk copy is allowed')

    def boot():
        for suffix in ['.pid', '-qmp.sock']:
            (directory / ('worker-a' + suffix)).unlink(missing_ok=True)
        with (directory / 'worker-a-recovery.log').open('ab') as output:
            process = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=output)
        spawned.append(process)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            assert process.poll() is None, 'Owned QEMU start failed'
            try:
                if remote('true', timeout=3).returncode == 0:
                    return process
            except subprocess.TimeoutExpired:
                pass
            time.sleep(.3)
        raise AssertionError('Restored guest readiness timed out')

    try:
        stopped(pid)
        shutil.copy2(directory / 'worker-a.qcow2', checkpoint)
        with checkpoint.open('rb') as source:
            checkpoint_digest = hashlib.file_digest(source, 'sha256').hexdigest()
        process = boot()
        active_tunnel = connect()
        assert active_tunnel.poll() is None
        socket_code = "const s=require('net').connect(19090,'127.0.0.1',()=>require('fs').writeFileSync('/home/researcher/revoke-connection-ready','connected'));setInterval(()=>{},1000)"
        assert remote('rm -f /home/researcher/revoke-connection-ready').returncode == 0
        socket_command = 'nohup /home/researcher/node/bin/node -e ' + shlex.quote(socket_code) + ' RESEARCH_REVOKE_CONNECTION > /home/researcher/revoke-connection.log 2>&1 < /dev/null &'
        assert remote(socket_command).returncode == 0
        for _ in range(20):
            if remote('test -e /home/researcher/revoke-connection-ready').returncode == 0:
                break
            time.sleep(.1)
        else:
            raise AssertionError('Guest broker connection never became ready')
        assert remote('rm -f /home/researcher/rollback-job.json && test ! -e /home/researcher/rollback-job.json').returncode == 0
        child = "nohup /home/researcher/node/bin/node -e 'setInterval(()=>{},1000)' RESEARCH_REVOKE_DESCENDANT > /home/researcher/revoke-child.log 2>&1 < /dev/null &"
        assert remote(child).returncode == 0
        assert remote("pgrep -f '[R]ESEARCH_REVOKE_DESCENDANT' > /dev/null").returncode == 0
        revoke()  # Trusted controller DB/epoch state is outside guest disk and must survive the restore.
        start = time.monotonic()
        stopped(process.pid)
        process.wait(timeout=5)
        active_tunnel.wait(timeout=5)
        assert active_tunnel.poll() is not None
        shutil.copy2(checkpoint, directory / 'worker-a.qcow2')
        with (directory / 'worker-a.qcow2').open('rb') as source:
            assert hashlib.file_digest(source, 'sha256').hexdigest() == checkpoint_digest
        process = boot()
        restored_file = remote('test -e /home/researcher/rollback-job.json')
        child_absent = remote("! pgrep -f '[R]ESEARCH_REVOKE_DESCENDANT' > /dev/null")
        assert restored_file.returncode == 0 and child_absent.returncode == 0
        actor_file.unlink()
        checkpoint.unlink()
        return {'priorAdmission': True, 'savedIdentityFileRestored': True, 'descendantAbsent': True,
                'diskDigestVerifiedBeforeBoot': True, 'activeBrokerTunnelTerminated': True, 'durationMs': round((time.monotonic() - start) * 1000)}, process
    except BaseException:
        for process in spawned:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)
        raise
