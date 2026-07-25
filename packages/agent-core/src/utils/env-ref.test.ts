import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ENV_REFERENCE_PREFIX,
  isEnvReference,
  formatEnvReference,
  resolveEnvReference,
  hasUsableSecretReference,
} from './env-ref.js';

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
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns the env value when set', () => {
      vi.stubEnv('TEST_API_KEY', 'sk-test-value');
      expect(resolveEnvReference('$ENV:TEST_API_KEY')).toBe('sk-test-value');
    });

    it('returns undefined when env var is not set', () => {
      vi.stubEnv('MISSING_KEY', undefined);
      expect(resolveEnvReference('$ENV:MISSING_KEY')).toBeUndefined();
    });

    it('returns the value as-is when not an env reference', () => {
      expect(resolveEnvReference('plain-api-key')).toBe('plain-api-key');
    });

    it('returns undefined for $ENV: with empty name', () => {
      expect(resolveEnvReference('$ENV:')).toBeUndefined();
    });

    it('trims whitespace from the env var name', () => {
      vi.stubEnv('SPACED_KEY', 'spaced-value');
      expect(resolveEnvReference('$ENV:  SPACED_KEY  ')).toBe('spaced-value');
    });
  });

  describe('hasUsableSecretReference', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns true for a plain non-empty string', () => {
      expect(hasUsableSecretReference('plain-api-key')).toBe(true);
    });

    it('returns true when env reference resolves to a value', () => {
      vi.stubEnv('MY_KEY', 'resolved-value');
      expect(hasUsableSecretReference('$ENV:MY_KEY')).toBe(true);
    });

    it('returns false for undefined', () => {
      expect(hasUsableSecretReference(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasUsableSecretReference('')).toBe(false);
    });

    it('returns false when env reference does not resolve', () => {
      vi.stubEnv('MISSING_KEY', undefined);
      expect(hasUsableSecretReference('$ENV:MISSING_KEY')).toBe(false);
    });
  });
});
