# Disposable KVM guest reproduction

This requires Linux x86_64, an accessible `/dev/kvm`, QEMU/qemu-img, xorriso, curl, sha256sum,
OpenSSH, Python 3.11 or later, Node 22.22.0, pnpm 8.15.4, and a built repository. The actual research
used QEMU 10.2.1 and an Ubuntu 24.04 image. This is not a procedure for reproducing cloud costs or
cloud API behavior. Commands are run from the repository root and create resources only in a
separate experiment directory. Downloading the official image is needed only in the preparation
stage, and the guest is not allowed outgoing network access.

## Image, artifact, and seed

```sh
TASK_VM_DIR=$(mktemp -d)
TASK_VM_DIR=$(cd "$TASK_VM_DIR" && pwd)
TASK_VM_HOME=$(mktemp -d)
TASK_NODE_BIN=$(command -v node)
TASK_POC_DIR="$PWD/research/agent-organization-security/poc"
curl --fail --location https://cloud-images.ubuntu.com/noble/20260926/noble-server-cloudimg-amd64.img \
  --output "$TASK_VM_DIR/noble-server-cloudimg-amd64.img"
curl --fail --location https://cloud-images.ubuntu.com/noble/20260926/SHA256SUMS \
  --output "$TASK_VM_DIR/SHA256SUMS"
(cd "$TASK_VM_DIR" && sha256sum --ignore-missing --check SHA256SUMS)
# SHA256 of the image used in the actual research: 6a81c37564db9b1ee84e141922625e1d7c5b389b99bb3c572e0243607d5bb4d2
ssh-keygen -q -t ed25519 -N '' -f "$TASK_VM_DIR/poc_ed25519"
env -i PATH="$PATH" HOME="$TASK_VM_HOME" PRODUCT_USER_STATE_DIR="$TASK_VM_HOME/state" \
  pnpm --filter @robota-sdk/agent-cli --prod deploy "$TASK_VM_DIR/cli-deploy"
tar -C "$TASK_VM_DIR/cli-deploy" -czf "$TASK_VM_DIR/cli-deployed-artifact.tar.gz" .
mkdir -p "$TASK_VM_DIR/node/bin"
cp "$TASK_NODE_BIN" "$TASK_VM_DIR/node/bin/node"
tar -C "$TASK_VM_DIR/node" -czf "$TASK_VM_DIR/node-runtime.tar.gz" bin/node
env -i PATH="$PATH" HOME="$TASK_VM_HOME" PRODUCT_USER_STATE_DIR="$TASK_VM_HOME/state" \
  pnpm exec tsx "$TASK_POC_DIR/prepare-vm-fixture.mts" "$TASK_VM_DIR/fixture"
mkdir -p "$TASK_VM_DIR/seed-runtime"
printf 'instance-id: issue-2-runtime\nlocal-hostname: research-runtime\n' > "$TASK_VM_DIR/seed-runtime/meta-data"
cat > "$TASK_VM_DIR/seed-runtime/user-data" <<'YAML'
#cloud-config
users:
  - name: researcher
    groups: [sudo]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
YAML
printf '      - %s\n' "$(cat "$TASK_VM_DIR/poc_ed25519.pub")" >> "$TASK_VM_DIR/seed-runtime/user-data"
xorriso -as mkisofs -output "$TASK_VM_DIR/seed-runtime.iso" -volid cidata -joliet -rock "$TASK_VM_DIR/seed-runtime"
qemu-img create -f qcow2 -F qcow2 -b "$TASK_VM_DIR/noble-server-cloudimg-amd64.img" "$TASK_VM_DIR/runtime.qcow2" 8G
```

The seed contains only a synthetic researcher user and this experiment's public SSH key. Guest sudo
represents the condition where a malicious task has taken over the whole guest, and does not grant
host privileges. Do not store the temporary private key in logs or reports, and do not substitute a
real account's key. A normal build of the repository must be complete before `pnpm deploy`. The
replay JSONL is an auxiliary fixture, and the actual CLI uses the HTTP provider below.

## Runtime start, configuration, and execution

```sh
qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -m 2048 -smp 2 \
  -drive "file=$TASK_VM_DIR/runtime.qcow2,if=virtio,format=qcow2" \
  -drive "file=$TASK_VM_DIR/seed-runtime.iso,media=cdrom,readonly=on" \
  -nic user,model=virtio-net-pci,restrict=on,hostfwd=tcp:127.0.0.1:22242-:22 \
  -display none -serial "file:$TASK_VM_DIR/runtime-serial.log" \
  -qmp "unix:$TASK_VM_DIR/runtime-qmp.sock,server,nowait" -pidfile "$TASK_VM_DIR/runtime.pid" &
```

The first research runtime used `-monitor unix:.../runtime-monitor.sock,server,nowait` instead of
QMP. The workers and re-runs of this recipe use QMP to inspect the actual KVM/status and the drive
configuration. `restrict=on` prevents the guest from using the host network or the internet
directly, and allows only the explicitly specified loopback SSH forward. Do not interpret this as a
domain allowlist, a DNS filter, or a boundary for every platform. Do not add virtiofs/9p/host
disk/device passthrough. Adding other disk files makes the setup differ from this experiment. SSH
readiness is checked with a bounded retry.

All SSH/SCP commands below use `-F /dev/null -o IdentitiesOnly=yes -i "$TASK_VM_DIR/poc_ed25519"`
and `-o "UserKnownHostsFile=$TASK_VM_DIR/known_hosts"`. Only the first connection to your own guest
specifies `StrictHostKeyChecking=accept-new`; afterwards specify `StrictHostKeyChecking=yes`.
The SSH port is 22242, and the SCP port is `-P 22242`. Check the exit codes of copies and remote
commands.

1. Create the `/home/researcher/node`, `cli`, `fixture`, `workspace`, and `poc-home` directories over SSH.
2. Copy the two tars above to `/home/researcher/` and extract them in `node` and `cli` respectively.
   Also copy the fixture's `product.env`, `mock-model.mjs`, and `probe-daemon.mjs`.
3. In the guest, start the loopback provider with `nohup /home/researcher/node/bin/node /home/researcher/mock-model.mjs 18080
   > /home/researcher/mock-model.log 2>&1 < /dev/null &`.
4. Configure the guest's actual provider. Apply the `env` and Node path below to every CLI run.

```sh
env -i PATH=/home/researcher/node/bin:/usr/bin:/bin HOME=/home/researcher/poc-home \
  PRODUCT_CONFIG_FILE=/home/researcher/fixture/product.env RESEARCH_FAKE_MODEL_KEY=synthetic-non-secret \
  /home/researcher/node/bin/node /home/researcher/cli/dist/node/bin.js \
  --configure-provider fixture --type openai --base-url http://127.0.0.1:18080/v1 \
  --model synthetic --api-key-env RESEARCH_FAKE_MODEL_KEY --set-current
```

On the host, run `python3 "$TASK_POC_DIR/vm-smoke.py" --vm-dir "$TASK_VM_DIR" --port 22242
--output "$TASK_VM_DIR/vm-smoke.json"`. For daemon verification, run `daemon start --json` twice with
the same guest env and workspace, save each stdout to `daemon-start.json` and `daemon-reuse.json`,
and run `node /home/researcher/probe-daemon.mjs`. The token URL is not printed. Afterwards, confirm
running=false from `daemon stop` and `daemon status --json`, and that the CLI has exited.

## Separate workers and cleanup

Use runtime.qcow2 as an immutable template only after confirming guest `sudo poweroff` and QEMU
shutdown. The running backing image must not be changed. For each of worker-a/b, create a seed with a
new instance-id and hostname, and create an independent overlay with
`qemu-img create -f qcow2 -F qcow2 -b "$TASK_VM_DIR/runtime.qcow2" .../worker-N.qcow2`. In the
runtime arguments above, change the disk/seed/name, and use memory 1536MB, ports 22243/22244, and
each worker's own QMP/serial/pid paths. Keep the actual arguments as a manifest. The synthetic
fixture on the base disk is shared, but each worker's writes are stored in a different overlay.

Pause and resume are observed with QMP stop/cont, and an offline disk checkpoint is copied only after
guest poweroff and QEMU shutdown. A disk checkpoint does not restore memory or active connections.
The revocation, budget, and approval journals are kept on the host control plane and are not rolled
back together with the worker disk. When the experiment ends, terminate only the QEMU with the exact
owned pid/QMP socket and cross-check with `ps` and failed connection attempts. Delete only your own
experiment directory and the key, overlays, seeds, and fixtures. Do not include production/shared
files. Preserve only versions, hashes, arguments, and results as evidence, and do not include guest
URL tokens or private keys.
