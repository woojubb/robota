import { describe, it, expect } from 'vitest';
import type {
  IPrompt,
  TPromptInputValue,
  TPromptLink,
  IPromptRequest,
  IPromptResponse,
  IQueueStatus,
  IHistoryEntry,
  INodeObjectInfo,
  ISystemStats,
} from '../types/prompt-types.js';

describe('Prompt types (derived from OpenAPI spec)', () => {
  it('should represent a valid prompt matching OpenAPI Prompt schema', () => {
    const prompt: IPrompt = {
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' },
      },
      '3': {
        class_type: 'KSampler',
        inputs: { seed: 8566257, model: ['4', 0] },
        _meta: { title: 'KSampler' },
      },
    };

    expect(prompt['3'].class_type).toBe('KSampler');
    expect(prompt['3'].inputs.model).toEqual(['4', 0]);
  });

  it('should represent request/response matching OpenAPI /prompt schemas', () => {
    const request: IPromptRequest = {
      prompt: { '1': { class_type: 'InputNode', inputs: { text: 'hello' } } },
      client_id: 'test-client-uuid',
    };
    const response: IPromptResponse = {
      prompt_id: 'abc-123',
      number: 1,
      node_errors: {},
    };

    expect(request.client_id).toBe('test-client-uuid');
    expect(response.prompt_id).toBe('abc-123');
  });

  it('should represent queue status matching OpenAPI /queue schema', () => {
    const queue: IQueueStatus = { queue_running: [], queue_pending: [] };
    expect(queue.queue_running).toEqual([]);
  });

  it('should represent history entry matching OpenAPI /history schema', () => {
    const entry: IHistoryEntry = {
      prompt: { '1': { class_type: 'InputNode', inputs: { text: 'hello' } } },
      outputs: {},
      status: { status_str: 'success', completed: true, messages: [] },
    };
    expect(entry.status.status_str).toBe('success');
  });

  it('should represent object_info matching OpenAPI /object_info schema', () => {
    const info: INodeObjectInfo = {
      display_name: 'KSampler',
      category: 'sampling',
      input: {
        required: {
          model: ['MODEL'],
          seed: ['INT', { default: 0, min: 0, max: 18446744073709551615 }],
        },
        optional: {},
      },
      output: ['LATENT'],
      output_is_list: [false],
      output_name: ['LATENT'],
      output_node: false,
      description: '',
    };

    expect(info.category).toBe('sampling');
    expect(info.output).toEqual(['LATENT']);
  });

  it('should represent system stats matching OpenAPI /system_stats schema', () => {
    const stats: ISystemStats = {
      system: { os: 'darwin', runtime_version: '', embedded_python: false },
      devices: [],
    };
    expect(stats.system.os).toBe('darwin');
  });

  it('should distinguish links from config values via Array.isArray', () => {
    const link: TPromptLink = ['4', 0];
    const configValue: TPromptInputValue = 'euler';
    expect(Array.isArray(link)).toBe(true);
    expect(Array.isArray(configValue)).toBe(false);
  });
});
