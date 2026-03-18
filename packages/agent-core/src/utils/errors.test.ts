import { describe, it, expect } from 'vitest';
import {
  RobotaError,
  ConfigurationError,
  ValidationError,
  ProviderError,
  AuthenticationError,
  RateLimitError,
  NetworkError,
  ToolExecutionError,
  ModelNotAvailableError,
  CircuitBreakerOpenError,
  PluginError,
  StorageError,
  ErrorUtils,
} from './errors';

describe('Error Classes', () => {
  describe('ConfigurationError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new ConfigurationError('bad config');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.category).toBe('user');
      expect(error.recoverable).toBe(false);
    });

    it('should format message with prefix', () => {
      const error = new ConfigurationError('missing field');
      expect(error.message).toBe('Configuration Error: missing field');
    });

    it('should store context', () => {
      const ctx = { field: 'name', value: 'test' };
      const error = new ConfigurationError('bad', ctx);
      expect(error.context).toEqual(ctx);
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new ConfigurationError('test');
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name on prototype chain', () => {
      const error = new ConfigurationError('test');
      expect(error.name).toBe('ConfigurationError');
    });
  });

  describe('ValidationError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new ValidationError('invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.category).toBe('user');
      expect(error.recoverable).toBe(false);
    });

    it('should format message with prefix', () => {
      const error = new ValidationError('field required');
      expect(error.message).toBe('Validation Error: field required');
    });

    it('should store optional field property', () => {
      const error = new ValidationError('required', 'email');
      expect(error.field).toBe('email');
    });

    it('should store context as third argument', () => {
      const ctx = { expected: 'string' };
      const error = new ValidationError('type mismatch', 'age', ctx);
      expect(error.context).toEqual(ctx);
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new ValidationError('test');
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ProviderError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new ProviderError('timeout', 'openai');
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.category).toBe('provider');
      expect(error.recoverable).toBe(true);
    });

    it('should format message with provider name', () => {
      const error = new ProviderError('connection lost', 'anthropic');
      expect(error.message).toBe('Provider Error (anthropic): connection lost');
    });

    it('should store provider and originalError', () => {
      const orig = new Error('underlying');
      const error = new ProviderError('failed', 'openai', orig);
      expect(error.provider).toBe('openai');
      expect(error.originalError).toBe(orig);
    });

    it('should store context', () => {
      const ctx = { operation: 'chat' };
      const error = new ProviderError('err', 'openai', undefined, ctx);
      expect(error.context).toEqual(ctx);
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new ProviderError('test', 'openai');
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('AuthenticationError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new AuthenticationError('invalid key');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.category).toBe('user');
      expect(error.recoverable).toBe(false);
    });

    it('should format message with prefix', () => {
      const error = new AuthenticationError('expired token');
      expect(error.message).toBe('Authentication Error: expired token');
    });

    it('should store optional provider', () => {
      const error = new AuthenticationError('bad key', 'openai');
      expect(error.provider).toBe('openai');
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new AuthenticationError('test');
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('RateLimitError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new RateLimitError('too many requests');
      expect(error.code).toBe('RATE_LIMIT_ERROR');
      expect(error.category).toBe('provider');
      expect(error.recoverable).toBe(true);
    });

    it('should format message with prefix', () => {
      const error = new RateLimitError('limit exceeded');
      expect(error.message).toBe('Rate Limit Error: limit exceeded');
    });

    it('should store retryAfter and provider', () => {
      const error = new RateLimitError('wait', 30, 'openai');
      expect(error.retryAfter).toBe(30);
      expect(error.provider).toBe('openai');
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new RateLimitError('test');
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('NetworkError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new NetworkError('connection refused');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.category).toBe('system');
      expect(error.recoverable).toBe(true);
    });

    it('should format message with prefix', () => {
      const error = new NetworkError('dns failure');
      expect(error.message).toBe('Network Error: dns failure');
    });

    it('should store originalError', () => {
      const orig = new Error('ECONNREFUSED');
      const error = new NetworkError('failed', orig);
      expect(error.originalError).toBe(orig);
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new NetworkError('test');
      expect(error).toBeInstanceOf(NetworkError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ToolExecutionError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new ToolExecutionError('failed', 'calculator');
      expect(error.code).toBe('TOOL_EXECUTION_ERROR');
      expect(error.category).toBe('system');
      expect(error.recoverable).toBe(false);
    });

    it('should format message with tool name', () => {
      const error = new ToolExecutionError('divide by zero', 'calculator');
      expect(error.message).toBe('Tool Execution Error (calculator): divide by zero');
    });

    it('should store toolName and originalError', () => {
      const orig = new Error('underlying');
      const error = new ToolExecutionError('err', 'search', orig);
      expect(error.toolName).toBe('search');
      expect(error.originalError).toBe(orig);
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new ToolExecutionError('test', 'tool');
      expect(error).toBeInstanceOf(ToolExecutionError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ModelNotAvailableError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new ModelNotAvailableError('gpt-5', 'openai');
      expect(error.code).toBe('MODEL_NOT_AVAILABLE');
      expect(error.category).toBe('user');
      expect(error.recoverable).toBe(false);
    });

    it('should format message with model and provider', () => {
      const error = new ModelNotAvailableError('gpt-5', 'openai');
      expect(error.message).toBe('Model "gpt-5" is not available for provider "openai"');
    });

    it('should store availableModels', () => {
      const models = ['gpt-4', 'gpt-3.5-turbo'];
      const error = new ModelNotAvailableError('gpt-5', 'openai', models);
      expect(error.availableModels).toEqual(models);
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new ModelNotAvailableError('model', 'provider');
      expect(error).toBeInstanceOf(ModelNotAvailableError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('CircuitBreakerOpenError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new CircuitBreakerOpenError();
      expect(error.code).toBe('CIRCUIT_BREAKER_OPEN');
      expect(error.category).toBe('system');
      expect(error.recoverable).toBe(true);
    });

    it('should use default message when none provided', () => {
      const error = new CircuitBreakerOpenError();
      expect(error.message).toBe('Circuit breaker is open');
    });

    it('should accept custom message', () => {
      const error = new CircuitBreakerOpenError('custom breaker message');
      expect(error.message).toBe('custom breaker message');
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new CircuitBreakerOpenError();
      expect(error).toBeInstanceOf(CircuitBreakerOpenError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('PluginError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new PluginError('init failed', 'myPlugin');
      expect(error.code).toBe('PLUGIN_ERROR');
      expect(error.category).toBe('system');
      expect(error.recoverable).toBe(false);
    });

    it('should format message with plugin name', () => {
      const error = new PluginError('load failed', 'cachePlugin');
      expect(error.message).toBe('Plugin Error (cachePlugin): load failed');
    });

    it('should store pluginName', () => {
      const error = new PluginError('err', 'myPlugin');
      expect(error.pluginName).toBe('myPlugin');
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new PluginError('test', 'plugin');
      expect(error).toBeInstanceOf(PluginError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('StorageError', () => {
    it('should set code, category, and recoverable', () => {
      const error = new StorageError('write failed');
      expect(error.code).toBe('STORAGE_ERROR');
      expect(error.category).toBe('system');
      expect(error.recoverable).toBe(true);
    });

    it('should format message with prefix', () => {
      const error = new StorageError('disk full');
      expect(error.message).toBe('Storage Error: disk full');
    });

    it('should store context', () => {
      const ctx = { path: '/data/store' };
      const error = new StorageError('failed', ctx);
      expect(error.context).toEqual(ctx);
    });

    it('should be instanceof RobotaError and Error', () => {
      const error = new StorageError('test');
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toBeInstanceOf(RobotaError);
      expect(error).toBeInstanceOf(Error);
    });
  });
});

describe('ErrorUtils', () => {
  describe('isRecoverable', () => {
    it('should return true for recoverable RobotaError subclasses', () => {
      expect(ErrorUtils.isRecoverable(new ProviderError('err', 'p'))).toBe(true);
      expect(ErrorUtils.isRecoverable(new RateLimitError('err'))).toBe(true);
      expect(ErrorUtils.isRecoverable(new NetworkError('err'))).toBe(true);
      expect(ErrorUtils.isRecoverable(new CircuitBreakerOpenError())).toBe(true);
      expect(ErrorUtils.isRecoverable(new StorageError('err'))).toBe(true);
    });

    it('should return false for non-recoverable RobotaError subclasses', () => {
      expect(ErrorUtils.isRecoverable(new ConfigurationError('err'))).toBe(false);
      expect(ErrorUtils.isRecoverable(new ValidationError('err'))).toBe(false);
      expect(ErrorUtils.isRecoverable(new AuthenticationError('err'))).toBe(false);
      expect(ErrorUtils.isRecoverable(new ToolExecutionError('err', 'tool'))).toBe(false);
      expect(ErrorUtils.isRecoverable(new PluginError('err', 'plugin'))).toBe(false);
    });

    it('should return false for plain Error', () => {
      expect(ErrorUtils.isRecoverable(new Error('plain'))).toBe(false);
    });
  });

  describe('getErrorCode', () => {
    it('should return error code for RobotaError subclasses', () => {
      expect(ErrorUtils.getErrorCode(new ConfigurationError('err'))).toBe('CONFIGURATION_ERROR');
      expect(ErrorUtils.getErrorCode(new ValidationError('err'))).toBe('VALIDATION_ERROR');
      expect(ErrorUtils.getErrorCode(new ProviderError('err', 'p'))).toBe('PROVIDER_ERROR');
    });

    it('should return UNKNOWN_ERROR for plain Error', () => {
      expect(ErrorUtils.getErrorCode(new Error('plain'))).toBe('UNKNOWN_ERROR');
    });
  });

  describe('fromUnknown', () => {
    it('should return RobotaError instances as-is', () => {
      const original = new ConfigurationError('already wrapped');
      const result = ErrorUtils.fromUnknown(original);
      expect(result).toBe(original);
    });

    it('should wrap plain Error into ConfigurationError', () => {
      const plain = new Error('plain error');
      const result = ErrorUtils.fromUnknown(plain);
      expect(result).toBeInstanceOf(ConfigurationError);
      expect(result.message).toContain('plain error');
    });

    it('should wrap string into ConfigurationError', () => {
      const result = ErrorUtils.fromUnknown('something broke');
      expect(result).toBeInstanceOf(ConfigurationError);
      expect(result.message).toContain('something broke');
    });

    it('should use default message for null', () => {
      const result = ErrorUtils.fromUnknown(null);
      expect(result).toBeInstanceOf(ConfigurationError);
      expect(result.message).toContain('An unknown error occurred');
    });

    it('should use default message for undefined', () => {
      const result = ErrorUtils.fromUnknown(undefined);
      expect(result).toBeInstanceOf(ConfigurationError);
      expect(result.message).toContain('An unknown error occurred');
    });

    it('should use default message for object input', () => {
      const result = ErrorUtils.fromUnknown({ key: 'value' });
      expect(result).toBeInstanceOf(ConfigurationError);
      expect(result.message).toContain('An unknown error occurred');
    });

    it('should use custom default message', () => {
      const result = ErrorUtils.fromUnknown(null, 'custom fallback');
      expect(result.message).toContain('custom fallback');
    });
  });

  describe('wrapProviderError', () => {
    it('should wrap Error into ProviderError with operation context', () => {
      const orig = new Error('timeout');
      const result = ErrorUtils.wrapProviderError(orig, 'openai', 'chat');
      expect(result).toBeInstanceOf(ProviderError);
      expect(result.provider).toBe('openai');
      expect(result.message).toContain('Failed to chat');
      expect(result.originalError).toBe(orig);
      expect(result.context).toEqual({ operation: 'chat' });
    });

    it('should wrap string into ProviderError', () => {
      const result = ErrorUtils.wrapProviderError('network down', 'anthropic', 'generate');
      expect(result).toBeInstanceOf(ProviderError);
      expect(result.provider).toBe('anthropic');
      expect(result.originalError?.message).toBe('network down');
    });

    it('should wrap null into ProviderError', () => {
      const result = ErrorUtils.wrapProviderError(null, 'google', 'embed');
      expect(result).toBeInstanceOf(ProviderError);
      expect(result.provider).toBe('google');
      expect(result.originalError?.message).toBe('null');
    });
  });
});
