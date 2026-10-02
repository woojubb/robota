# 폐기 가능한 KVM guest 재현

Linux x86_64, 접근 가능한 `/dev/kvm`, QEMU/qemu-img, xorriso, curl, sha256sum,
OpenSSH, Python 3.11 이상, Node 22.22.0, pnpm 8.15.4와 빌드된 저장소가 필요하다. 실제 연구에서
QEMU 10.2.1과 Ubuntu 24.04 image를 썼다. cloud 비용·API 동작을 재현하는 절차는 아니다.
명령은 저장소 root에서 실행하며 별도 실험 디렉터리의 자원만 생성한다. 준비 단계에서만
공식 image 다운로드가 필요하고 guest에는 outgoing network를 허용하지 않는다.

## Image·artifact·seed

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
# 실제 연구 image SHA256: 6a81c37564db9b1ee84e141922625e1d7c5b389b99bb3c572e0243607d5bb4d2
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

Seed는 합성 researcher 사용자와 이 실험의 public SSH key만 포함한다. guest sudo는 악성 작업이
guest 전체를 장악한 조건을 나타내며 host 권한을 주지 않는다. 임시 private key를 로그·보고서에
저장하거나 실제 계정 key를 대신 사용하지 않는다. `pnpm deploy` 전에는 저장소의 정상 build가
완료돼 있어야 한다. replay JSONL은 보조 fixture이며 실제 CLI는 아래 HTTP provider를 사용한다.

## Runtime 시작·구성·실행

```sh
qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -m 2048 -smp 2 \
  -drive "file=$TASK_VM_DIR/runtime.qcow2,if=virtio,format=qcow2" \
  -drive "file=$TASK_VM_DIR/seed-runtime.iso,media=cdrom,readonly=on" \
  -nic user,model=virtio-net-pci,restrict=on,hostfwd=tcp:127.0.0.1:22242-:22 \
  -display none -serial "file:$TASK_VM_DIR/runtime-serial.log" \
  -qmp "unix:$TASK_VM_DIR/runtime-qmp.sock,server,nowait" -pidfile "$TASK_VM_DIR/runtime.pid" &
```

최초 연구 runtime은 QMP 대신 `-monitor unix:.../runtime-monitor.sock,server,nowait`를 썼다.
worker 및 이 recipe의 재실행은 QMP를 써서 실제 KVM/status와 drive 구성을 검사한다.
`restrict=on`은 guest가 host network·인터넷을 직접 사용하지 못하게 하고, 명시한 loopback
SSH forward만 허용한다. 이것을 domain allowlist, DNS filter 또는 모든 플랫폼의 경계라고
해석하지 않는다. virtiofs/9p/host disk/device passthrough는 넣지 않는다. 다른 disk 파일을
추가하면 이 실험과 같지 않다. SSH readiness는 bounded retry로 확인한다.

아래 SSH/SCP 모두 `-F /dev/null -o IdentitiesOnly=yes -i "$TASK_VM_DIR/poc_ed25519"`
및 `-o "UserKnownHostsFile=$TASK_VM_DIR/known_hosts"`를 사용한다. 최초 자기 guest 접속에만
`StrictHostKeyChecking=accept-new`, 이후에는 `StrictHostKeyChecking=yes`를 지정한다.
SSH port는 22242, SCP port는 `-P 22242`다. 복사·원격 명령의 exit code를 확인한다.

1. SSH로 `/home/researcher/node`, `cli`, `fixture`, `workspace`, `poc-home` 디렉터리를 만든다.
2. 위 두 tar를 `/home/researcher/`로 복사하고 각각 `node`, `cli`에서 압축 해제한다.
   fixture의 `product.env`와 `mock-model.mjs`, `probe-daemon.mjs`도 복사한다.
3. guest에서 `nohup /home/researcher/node/bin/node /home/researcher/mock-model.mjs 18080
   > /home/researcher/mock-model.log 2>&1 < /dev/null &`로 loopback provider를 시작한다.
4. guest의 실제 provider를 설정한다. 아래 `env`와 Node 경로를 CLI 모든 실행에 적용한다.

```sh
env -i PATH=/home/researcher/node/bin:/usr/bin:/bin HOME=/home/researcher/poc-home \
  PRODUCT_CONFIG_FILE=/home/researcher/fixture/product.env RESEARCH_FAKE_MODEL_KEY=synthetic-non-secret \
  /home/researcher/node/bin/node /home/researcher/cli/dist/node/bin.js \
  --configure-provider fixture --type openai --base-url http://127.0.0.1:18080/v1 \
  --model synthetic --api-key-env RESEARCH_FAKE_MODEL_KEY --set-current
```

Host에서 `python3 "$TASK_POC_DIR/vm-smoke.py" --vm-dir "$TASK_VM_DIR" --port 22242
--output "$TASK_VM_DIR/vm-smoke.json"`를 실행한다. daemon 검증은 같은 guest env와 workspace에서
`daemon start --json`을 두 번 실행해 각 stdout을 `daemon-start.json`, `daemon-reuse.json`에
저장하고 `node /home/researcher/probe-daemon.mjs`를 실행한다. token URL은 출력하지 않는다.
이후 `daemon stop`, `daemon status --json`의 running=false와 CLI 종료를 확인한다.

## 별도 worker와 정리

Guest `sudo poweroff`와 QEMU 종료를 확인한 뒤에만 runtime.qcow2를 immutable template로 쓴다.
실행 중인 backing image를 바꾸면 안 된다. worker-a/b 각각 새 instance-id와 hostname의 seed를
만들고 `qemu-img create -f qcow2 -F qcow2 -b "$TASK_VM_DIR/runtime.qcow2" .../worker-N.qcow2`로
독립 overlay를 만든다. 위 runtime 인자에서 disk/seed/name을 바꾸고 memory 1536MB, port
22243/22244, 각 worker의 QMP/serial/pid 경로를 쓴다. 실제 인자는 manifest로 남긴다.
Base disk의 합성 fixture는 공유하지만 각 worker의 쓰기는 다른 overlay에 저장된다.

중단·재개는 QMP stop/cont로 관측하며, offline disk checkpoint는 guest poweroff/QEMU 종료
후에만 복사한다. disk checkpoint는 메모리나 active connection을 복원하지 않는다. 회수·예산·
승인 journal은 host control plane에 두고 worker disk와 함께 롤백하지 않는다.
실험이 끝나면 정확한 owned pid/QMP socket의 QEMU만 종료하고 `ps`와 접속 실패로 대조한다.
본인 실험 디렉터리 및 key·overlays·seed·fixtures만 삭제한다. production/shared 파일은 포함하지
않는다. 증거에는 버전·hash·인자·결과만 보존하며 guest URL token이나 private key는 넣지 않는다.
