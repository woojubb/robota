import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ENV_REFERENCE_PREFIX,
  isEnvReference,
  formatEnvReference,
  resolveEnvReference,
  hasUsableSecretReference,
} from './env-ref.js';
import { createRecordEnvResolver } from './env-resolver.js';
import { processEnvResolver } from './process-env-resolver.js';

describe('env-ref utilities', () => {
  describe('ENV_REFERENCE_PREFIX', () => {
    it('is $ENV:', () => {
      expect(ENV_REFERENCE_PREFIX).toBe('$ENV:');
    });
  });

  describe('isEnvReference', () => {
    it('returns true for $ENV: prefixed strings', () => {
      expect(isEnvReference('$ENV:MY_KEY')).toBe(true);
    });

    it('returns false for plain strings', () => {
      expect(isEnvReference('plain-api-key')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isEnvReference('')).toBe(false);
    });

    it('returns false for partial prefix', () => {
      expect(isEnvReference('$ENV')).toBe(false);
    });
  });

  describe('formatEnvReference', () => {
    it('formats a name as $ENV:<name>', () => {
      expect(formatEnvReference('MY_KEY')).toBe('$ENV:MY_KEY');
    });

    it('formats empty name', () => {
      expect(formatEnvReference('')).toBe('$ENV:');
    });
  });

  describe('resolveEnvReference', () => {
    it('returns the env value when set', () => {
      const resolve = createRecordEnvResolver({ TEST_API_KEY: 'sk-test-value' });
      expect(resolveEnvReference('$ENV:TEST_API_KEY', resolve)).toBe('sk-test-value');
    });

    it('returns undefined when env var is not set', () => {
      expect(resolveEnvReference('$ENV:MISSING_KEY', createRecordEnvResolver({}))).toBeUndefined();
    });

    it('returns the value as-is when not an env reference', () => {
      expect(resolveEnvReference('plain-api-key', createRecordEnvResolver({}))).toBe(
        'plain-api-key',
      );
    });

    it('returns undefined for $ENV: with empty name', () => {
      expect(resolveEnvReference('$ENV:', createRecordEnvResolver({}))).toBeUndefined();
    });

    it('trims whitespace from the env var name', () => {
      const resolve = createRecordEnvResolver({ SPACED_KEY: 'spaced-value' });
      expect(resolveEnvReference('$ENV:  SPACED_KEY  ', resolve)).toBe('spaced-value');
    });

    describe('with the host environment', () => {
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it('reads process.env through processEnvResolver', () => {
        vi.stubEnv('HOST_API_KEY', 'host-value');
        expect(resolveEnvReference('$ENV:HOST_API_KEY', processEnvResolver)).toBe('host-value');
      });

      it('returns undefined when the host variable is not set', () => {
        vi.stubEnv('MISSING_HOST_KEY', undefined);
        expect(resolveEnvReference('$ENV:MISSING_HOST_KEY', processEnvResolver)).toBeUndefined();
      });
    });
  });

  describe('hasUsableSecretReference', () => {
    it('returns true for a plain non-empty string', () => {
      expect(hasUsableSecretReference('plain-api-key', createRecordEnvResolver({}))).toBe(true);
    });

    it('returns true when env reference resolves to a value', () => {
      const resolve = createRecordEnvResolver({ MY_KEY: 'resolved-value' });
      expect(hasUsableSecretReference('$ENV:MY_KEY', resolve)).toBe(true);
    });

    it('returns false for undefined', () => {
      expect(hasUsableSecretReference(undefined, createRecordEnvResolver({}))).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasUsableSecretReference('', createRecordEnvResolver({}))).toBe(false);
    });

    it('returns false when env reference does not resolve', () => {
      expect(hasUsableSecretReference('$ENV:MISSING_KEY', createRecordEnvResolver({}))).toBe(false);
    });
  });
});
