import { MCPActivationAdmissionService, type IMCPActivationRequest } from '../src/index.js';

function request(overrides: Partial<IMCPActivationRequest> = {}): IMCPActivationRequest {
  return {
    serverId: 'example-server',
    endpoint: 'https://mcp.example.test/mcp',
    source: 'project',
    provenance: { kind: 'project', id: 'example-project', version: '1' },
    definitionFingerprint: 'definition-v1',
    securityIdentity: 'identity-v1',
    workspace: { repositoryKey: 'example-repository', trustState: 'trusted', generation: 1 },
    ...overrides,
  };
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runStatusScenario(): void {
  const service = new MCPActivationAdmissionService();
  const status = service.inspect(
    request({
      workspace: { repositoryKey: 'example-repository', trustState: 'untrusted', generation: 1 },
    }),
  );
  assertCondition(
    status.status === 'untrusted' && !status.allowed,
    'untrusted request was admitted',
  );
  process.stdout.write('result=status=untrusted; activationAttempts=0\n');
}

function runLifecycleScenario(): void {
  const service = new MCPActivationAdmissionService();
  const original = request();
  const approved = service.approve(original);
  const admitted = service.admit(original);
  const changed = service.inspect({ ...original, definitionFingerprint: 'definition-v2' });
  service.revoke(original);
  const revoked = service.inspect(original);

  assertCondition(approved.allowed && admitted.allowed, 'exact trusted request was not admitted');
  assertCondition(changed.status === 'stale', 'changed definition remained admitted');
  assertCondition(
    revoked.status === 'revoked' && !revoked.allowed,
    'revoked definition remained admitted',
  );
  process.stdout.write(
    `result=approved=true; changedDefinitionDenied=${!changed.allowed}; revokedDenied=${!revoked.allowed}; activationAttempts=1\n`,
  );
}

const mode = process.argv.at(-1);
if (mode === '--status') runStatusScenario();
else if (mode === '--lifecycle') runLifecycleScenario();
else throw new Error('Usage: verify-mcp-activation-admission.ts --status|--lifecycle');
