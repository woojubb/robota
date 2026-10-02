"""Execute the actual driver's cleanup AST on disposable processes with injected timeouts."""
import argparse
import ast
import json
import multiprocessing
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--before', type=Path, default=Path(__file__).with_name('fixtures') / 'cleanup-before-fix.py',
                    help='pre-fix cleanup AST snapshot for the red-before control')
args = parser.parse_args()
context = multiprocessing.get_context('fork')
records = []


def extract(path, fault):
    tree = ast.parse(path.read_text())
    block = next(node.finalbody for node in ast.walk(tree) if isinstance(node, ast.Try)
                 and node.finalbody and isinstance(node.finalbody[0], (ast.If, ast.Assign))
                 and 'recovered_process' in ast.unparse(ast.Module(body=node.finalbody, type_ignores=[])))
    helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'stop_command']
    wrapper = ast.parse('def cleanup(recovered_process, tunnels, processes):\n    pass\n').body[0]
    wrapper.body = block
    module = ast.fix_missing_locations(ast.Module(body=helpers + [wrapper], type_ignores=[]))
    def shutdown(*argv, **kwargs):
        if fault == 'ssh-timeout':
            raise subprocess.TimeoutExpired('owned-test-shutdown', 10)
        return subprocess.CompletedProcess(['owned-test-shutdown'], 0)
    namespace = {'subprocess': SimpleNamespace(run=shutdown, TimeoutExpired=subprocess.TimeoutExpired),
                 'ssh': lambda actor: ['owned-test-ssh']}
    exec(compile(module, str(path), 'exec'), namespace)
    return namespace['cleanup']


class Worker:
    def __init__(self, process, fault):
        self.process, self.fault = process, fault
    def poll(self):
        return self.process.poll()
    def wait(self, timeout):
        if self.fault == 'worker-wait-timeout' and timeout == 60:
            raise subprocess.TimeoutExpired('owned-test-worker', timeout)
        return self.process.wait(timeout=timeout)
    def terminate(self):
        self.process.terminate()
    def kill(self):
        self.process.kill()


def probe(path, fault, unsafe=False):
    worker = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], stderr=subprocess.PIPE)
    tunnel = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], stderr=subprocess.PIPE)
    broker = context.Process(target=time.sleep, args=(120,))
    effect = context.Process(target=time.sleep, args=(120,))
    broker.start(); effect.start()
    error = None
    try:
        try:
            extract(path, fault)(Worker(worker, fault), [tunnel], [broker, effect])
        except Exception as failure:
            error = type(failure).__name__
        still = {'worker': worker.poll() is None, 'tunnel': tunnel.poll() is None,
                 'broker': broker.is_alive(), 'effect': effect.is_alive()}
        passed = all(still.values()) if unsafe else not any(still.values()) and error == 'RuntimeError'
        records.append({'id': ('unsafe-before-' if unsafe else 'current-') + fault,
                        'stillRunningAfterCleanup': still, 'reportedErrorType': error, 'passed': passed})
        assert passed
    finally:
        for process in [worker, tunnel]:
            if process.poll() is None: process.kill()
            process.wait(timeout=5)
            process.stderr.close()
        for process in [broker, effect]:
            if process.is_alive(): process.kill()
            process.join(timeout=5)
            assert not process.is_alive()


if args.before:
    probe(args.before, 'ssh-timeout', unsafe=True)
for fault in ['ssh-timeout', 'worker-wait-timeout']:
    probe(Path(__file__).with_name('parallel-experiment.py'), fault)
args.output.write_text(json.dumps({'kind': 'actual-owned-process-cleanup-faults', 'records': records,
    'limitations': ['Driver cleanup AST is executed directly; subprocess and multiprocessing children are real disposable sleepers, not QEMU or SSH services.',
                    'Shutdown faults are injected as TimeoutExpired; no production/cloud resources are accessed.']}, indent=2) + '\n')
print(f'{len(records)} cleanup fault observations passed')
