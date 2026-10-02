"""Real CLI admission probes over SSH to an already provisioned disposable VM.

Uses only the experiment's temporary SSH key. Captures exit codes separately from
artifact assertions; a model's final text is never treated as proof a tool ran.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--vm-dir", type=Path, required=True)
parser.add_argument("--port", type=int, default=22242)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--deny-file-tool", choices=['Read', 'Bash'])
args = parser.parse_args()
ssh = ["ssh", "-F", "/dev/null", "-o", "IdentitiesOnly=yes", "-o",
       "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={args.vm_dir / 'known_hosts'}",
       "-i", str(args.vm_dir / "poc_ed25519"), "-p", str(args.port), "researcher@127.0.0.1"]


def remote(command):
    return subprocess.run(ssh + [command], capture_output=True, text=True, timeout=30)


base = ("cd /home/researcher/workspace && env -i "
        "PATH=/home/researcher/node/bin:/usr/bin:/bin HOME=/home/researcher/poc-home "
        "PRODUCT_CONFIG_FILE=/home/researcher/fixture/product.env "
        "RESEARCH_FAKE_MODEL_KEY=synthetic-non-secret "
        "/home/researcher/node/bin/node /home/researcher/cli/dist/node/bin.js "
        "-p --safe-mode --no-session-persistence ")
run_id = uuid.uuid4().hex
file_root = '/home/researcher/workspace/file-proof-' + run_id
file_check = ('cd ' + file_root + ' && test "$(git rev-list --count HEAD)" = 1 && '
              'test "$(git show HEAD:file-canary.txt)" = synthetic-file-canary-' + run_id + ' && '
              "grep -Fq '\"runId\":\"" + run_id + "\",\"canaryPresent\":true' /home/researcher/mock-model.log")
assert remote('test ! -e ' + file_root).returncode == 0, 'Fresh proof repository must not already exist'
records = []
for name, command, check, marker in [
    ("headless", "RESEARCH_HEADLESS", "true", "RESEARCH_HEADLESS_VM_OK"),
    ("shell-default-denied", "RESEARCH_SHELL_DEFAULT", "test ! -e /home/researcher/workspace/shell-result.txt", "RESEARCH_SHELL_FINISHED"),
    ("shell-explicit-allow", "--allowed-tools Bash RESEARCH_SHELL_ALLOWED", "test \"$(cat /home/researcher/workspace/shell-result.txt)\" = shell-ok", "RESEARCH_SHELL_FINISHED"),
    ("file-read-write-git", "--allowed-tools Bash,Write,Read RESEARCH_FILES_" + run_id, file_check, "RESEARCH_FILES_FINISHED"),
    ("subagent-child-file", "--preset autonomous-builder --allowed-tools research_agent_command_agent,Bash RESEARCH_SUBAGENT_PARENT", "test \"$(cat /home/researcher/workspace/subagent-result.txt)\" = child-ok", "RESEARCH_SUBAGENT_FINISHED"),
]:
    cleanup = remote("rm -f /home/researcher/workspace/shell-result.txt /home/researcher/workspace/subagent-result.txt /home/researcher/workspace/file-canary.txt")
    assert cleanup.returncode == 0, "Canary reset failed"
    start = time.monotonic()
    negative = name == 'file-read-write-git' and args.deny_file_tool is not None
    if negative:
        command = '--denied-tools ' + args.deny_file_tool + ' ' + command
    result = remote(base + command)
    assertion = remote(check)
    (args.vm_dir / f"{name}-verified.log").write_text(result.stdout + result.stderr)
    passed = result.returncode == 0 and marker in result.stdout and (assertion.returncode != 0 if negative else assertion.returncode == 0)
    if negative:
        name += '-negative-deny-' + args.deny_file_tool
    records.append({"id": name, "runId": run_id, "cliExitCode": result.returncode,
                    "artifactCheckExitCode": assertion.returncode,
                    "markerPresent": marker in result.stdout, "expectedArtifactPredicate": not negative,
                    "durationMs": round((time.monotonic() - start) * 1000), "passed": passed})
    args.output.write_text(json.dumps({"kind": "actual-cli-disposable-vm-smoke", "records": records}, indent=2) + "\n")
args.output.write_text(json.dumps({"kind": "actual-cli-disposable-vm-smoke", "records": records,
                                 "limitations": ["No cloud provider or multi-worker result follows from these CLI probes.",
                                                 "The model is deterministic; CLI and tools are production implementations."]}, indent=2) + "\n")
assert remote('rm -rf ' + file_root).returncode == 0, 'Owned proof repository cleanup failed'
assert all(record['passed'] for record in records), 'A real CLI probe failed; evidence was retained'
print(f"{len(records)} real CLI probes passed with separate exit/artifact checks")
