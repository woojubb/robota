import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionPermissionGate, parseSessionPermissionsFromEnv } from '../session/session-gate.js';

describe('SessionPermissionGate', () => {
  describe('checkNodeTypes', () => {
    it('allows any node type when no restrictions configured', () => {
      const gate = new SessionPermissionGate({});
      expect(gate.checkNodeTypes(['input', 'llm-text', 'text-output'])).toBeUndefined();
    });

    it('blocks a node type not in allowedNodeTypes', () => {
      const gate = new SessionPermissionGate({
        allowedNodeTypes: ['input', 'text-output'],
      });
      const violation = gate.checkNodeTypes(['input', 'llm-text', 'text-output']);
      expect(violation?.code).toBe('NODE_TYPE_NOT_PERMITTED');
      expect(violation?.message).toContain('llm-text');
      expect(violation?.fix?.options).toEqual(['input', 'text-output']);
    });

    it('blocks a denied node type even when allowedNodeTypes includes it', () => {
      const gate = new SessionPermissionGate({
        allowedNodeTypes: ['input', 'llm-text', 'text-output'],
        deniedNodeTypes: ['llm-text'],
      });
      const violation = gate.checkNodeTypes(['input', 'llm-text']);
      expect(violation?.code).toBe('NODE_TYPE_DENIED');
    });

    it('allows all types when allowedNodeTypes is undefined', () => {
      const gate = new SessionPermissionGate({ deniedNodeTypes: ['llm-text'] });
      const violation = gate.checkNodeTypes(['input', 'text-output']);
      expect(violation).toBeUndefined();
    });
  });

  describe('checkInstantNodeCreation', () => {
    it('allows instant node creation by default', () => {
      const gate = new SessionPermissionGate({});
      expect(gate.checkInstantNodeCreation()).toBeUndefined();
    });

    it('blocks instant node creation when canCreateInstantNodes=false', () => {
      const gate = new SessionPermissionGate({ canCreateInstantNodes: false });
      const violation = gate.checkInstantNodeCreation();
      expect(violation?.code).toBe('INSTANT_NODE_NOT_PERMITTED');
    });

    it('allows instant node creation when canCreateInstantNodes=true', () => {
      const gate = new SessionPermissionGate({ canCreateInstantNodes: true });
      expect(gate.checkInstantNodeCreation()).toBeUndefined();
    });
  });

  describe('chargeCost', () => {
    it('allows cost within budget', () => {
      const gate = new SessionPermissionGate({ maxCostUsd: 1.0 });
      expect(gate.chargeCost(0.5)).toBeUndefined();
      expect(gate.chargeCost(0.4)).toBeUndefined();
    });

    it('blocks cost that would exceed budget', () => {
      const gate = new SessionPermissionGate({ maxCostUsd: 1.0 });
      gate.chargeCost(0.9);
      const violation = gate.chargeCost(0.2);
      expect(violation?.code).toBe('SESSION_BUDGET_EXCEEDED');
      expect(violation?.message).toContain('$1.0000');
    });

    it('allows unlimited cost when maxCostUsd is not set', () => {
      const gate = new SessionPermissionGate({});
      expect(gate.chargeCost(9999)).toBeUndefined();
    });
  });

  describe('checkExpiry', () => {
    it('returns undefined for a non-expiring session', () => {
      const gate = new SessionPermissionGate({});
      expect(gate.checkExpiry()).toBeUndefined();
    });

    it('returns violation for an expired session', () => {
      const gate = new SessionPermissionGate({}, 'sess-1');
      (gate as unknown as { session: { expiresAt: number } }).session.expiresAt = Date.now() - 1000;
      const violation = gate.checkExpiry();
      expect(violation?.code).toBe('SESSION_EXPIRED');
    });
  });
});

describe('parseSessionPermissionsFromEnv', () => {
  beforeEach(() => {
    delete process.env['DAG_SESSION_PERMISSIONS'];
  });
  afterEach(() => {
    delete process.env['DAG_SESSION_PERMISSIONS'];
  });

  it('returns undefined when env var is not set', () => {
    expect(parseSessionPermissionsFromEnv()).toBeUndefined();
  });

  it('parses valid JSON permissions', () => {
    process.env['DAG_SESSION_PERMISSIONS'] = JSON.stringify({
      allowedNodeTypes: ['input', 'text-output'],
      maxCostUsd: 0.5,
    });
    const perms = parseSessionPermissionsFromEnv();
    expect(perms?.allowedNodeTypes).toEqual(['input', 'text-output']);
    expect(perms?.maxCostUsd).toBe(0.5);
  });

  it('returns undefined for invalid JSON', () => {
    process.env['DAG_SESSION_PERMISSIONS'] = 'not-valid-json{';
    expect(parseSessionPermissionsFromEnv()).toBeUndefined();
  });
});
