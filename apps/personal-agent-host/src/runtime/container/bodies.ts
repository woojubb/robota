import type { IUnitSecrets, IUnitSpec } from '../port.js';
import {
  API_KEY_VARIABLE,
  bridgeName,
  GUI_PORT,
  INGRESS_VARIABLE,
  LABEL_ACCOUNT,
  LABEL_IMAGE,
  LABEL_INSTALL,
  LABEL_KIND,
  LABEL_SLOT,
  objectName,
  STATE_PATH,
  volumeName,
  type IAccountNetwork,
} from './names.js';

const MB = 1024 * 1024;
const NANO = 1_000_000_000;
const TMP_SIZE_MB = 256;
const LOG_MAX_SIZE = '10m';
const LOG_MAX_FILES = '3';
const HEALTH_INTERVAL_S = 2;
const HEALTH_TIMEOUT_S = 3;
const HEALTH_START_S = 20;
const HEALTH_RETRIES = 3;

export type EngineBody = Record<string, unknown>;

export function unitLabels(
  spec: IUnitSpec,
  kind: 'unit' | 'helper' = 'unit',
): Record<string, string> {
  return {
    [LABEL_INSTALL]: spec.installId,
    [LABEL_ACCOUNT]: spec.account,
    [LABEL_SLOT]: String(spec.subnetSlot),
    [LABEL_IMAGE]: spec.image,
    [LABEL_KIND]: kind,
  };
}

export function volumeBody(spec: IUnitSpec): EngineBody {
  return { Name: volumeName(spec.installId, spec.account), Labels: unitLabels(spec) };
}

/** One bridge per account: an explicit /29, IPv4 only, no traffic between containers. */
export function networkBody(spec: IUnitSpec, network: IAccountNetwork): EngineBody {
  return {
    Name: objectName(spec.installId, spec.account),
    Driver: 'bridge',
    EnableIPv6: false,
    Internal: false,
    Attachable: false,
    CheckDuplicate: true,
    IPAM: {
      Driver: 'default',
      Config: [{ Subnet: network.cidr, Gateway: network.gateway }],
    },
    Options: {
      'com.docker.network.bridge.name': bridgeName(spec.installId, spec.subnetSlot),
      'com.docker.network.bridge.enable_icc': 'false',
      'com.docker.network.bridge.enable_ip_masquerade': 'true',
    },
    Labels: unitLabels(spec),
  };
}

/** The probe the engine runs inside the unit: the forwarder's address, answering 200 once the app is ready. */
const HEALTH_SCRIPT =
  `require('http').get({host:process.env.${INGRESS_VARIABLE},port:${GUI_PORT},path:'/',` +
  `headers:{host:'127.0.0.1'},timeout:2500},r=>process.exit(r.statusCode===200?0:1))` +
  `.on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))`;

/**
 * The environment of a unit. The key is the only secret in it, passed under a variable whose name
 * the agent is told, so only that name is ever saved in the unit's volume.
 */
export function unitEnvironment(spec: IUnitSpec, secrets: IUnitSecrets, address: string): string[] {
  const env = [
    `PERSONAL_AGENT_PUBLIC_URL=${spec.publicOrigin}`,
    `${INGRESS_VARIABLE}=${address}`,
    `PERSONAL_AGENT_PROVIDER=${spec.provider.type}`,
  ];
  if (spec.provider.model !== undefined) env.push(`PERSONAL_AGENT_MODEL=${spec.provider.model}`);
  if (spec.provider.baseUrl !== undefined)
    env.push(`PERSONAL_AGENT_BASE_URL=${spec.provider.baseUrl}`);
  if (secrets.modelApiKey !== undefined && secrets.modelApiKey !== '') {
    env.push(
      `PERSONAL_AGENT_API_KEY_ENV=${API_KEY_VARIABLE}`,
      `${API_KEY_VARIABLE}=${secrets.modelApiKey}`,
    );
  }
  return env;
}

/** Everything that hardens and limits a unit. No published ports, no restart policy, one mount. */
export function unitContainerBody(
  spec: IUnitSpec,
  secrets: IUnitSecrets,
  network: IAccountNetwork,
): EngineBody {
  const net = objectName(spec.installId, spec.account);
  return {
    Image: spec.image,
    Hostname: spec.account,
    Env: unitEnvironment(spec, secrets, network.unit),
    Labels: unitLabels(spec),
    Healthcheck: {
      Test: ['CMD', 'node', '-e', HEALTH_SCRIPT],
      Interval: HEALTH_INTERVAL_S * NANO,
      Timeout: HEALTH_TIMEOUT_S * NANO,
      StartPeriod: HEALTH_START_S * NANO,
      Retries: HEALTH_RETRIES,
    },
    HostConfig: {
      Privileged: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': `rw,nosuid,nodev,size=${TMP_SIZE_MB}m` },
      Mounts: [
        { Type: 'volume', Source: volumeName(spec.installId, spec.account), Target: STATE_PATH },
      ],
      NetworkMode: net,
      PublishAllPorts: false,
      PortBindings: {},
      Memory: spec.limits.memoryMb * MB,
      MemorySwap: spec.limits.memoryMb * MB,
      NanoCpus: Math.round(spec.limits.cpus * NANO),
      PidsLimit: spec.limits.pids,
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': LOG_MAX_SIZE, 'max-file': LOG_MAX_FILES },
      },
      RestartPolicy: { Name: 'no' },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [net]: { IPAMConfig: { IPv4Address: network.unit } },
      },
    },
  };
}
