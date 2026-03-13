import { describe, it, expect } from 'vitest';
import { PROMPT_API_OPENAPI_DOCUMENT } from '../docs/openapi-prompt-api.js';

describe('Prompt API OpenAPI spec', () => {
  it('should have correct openapi version', () => {
    expect(PROMPT_API_OPENAPI_DOCUMENT.openapi).toBe('3.0.3');
  });

  it('should define all prompt API endpoints', () => {
    const paths = Object.keys(PROMPT_API_OPENAPI_DOCUMENT.paths);
    expect(paths).toContain('/prompt');
    expect(paths).toContain('/queue');
    expect(paths).toContain('/history');
    expect(paths).toContain('/history/{prompt_id}');
    expect(paths).toContain('/object_info');
    expect(paths).toContain('/object_info/{node_type}');
    expect(paths).toContain('/system_stats');
  });

  it('should define POST /prompt with correct request body', () => {
    const post = PROMPT_API_OPENAPI_DOCUMENT.paths['/prompt'].post;
    expect(post).toBeDefined();
    expect(post.operationId).toBe('submitPrompt');

    const requestBody = post.requestBody.content['application/json'].schema;
    expect(requestBody.properties.prompt).toBeDefined();
    expect(requestBody.properties.client_id).toBeDefined();
    expect(requestBody.properties.extra_data).toBeDefined();
    expect(requestBody.required).toContain('prompt');
  });

  it('should define POST /prompt response with prompt_id', () => {
    const response = PROMPT_API_OPENAPI_DOCUMENT.paths['/prompt'].post.responses['200'];
    const schema = response.content['application/json'].schema;
    expect(schema.properties.prompt_id.type).toBe('string');
    expect(schema.properties.number.type).toBe('integer');
    expect(schema.properties.node_errors).toBeDefined();
  });

  it('should define GET /queue response', () => {
    const response = PROMPT_API_OPENAPI_DOCUMENT.paths['/queue'].get.responses['200'];
    const schema = response.content['application/json'].schema;
    expect(schema.properties.queue_running).toBeDefined();
    expect(schema.properties.queue_pending).toBeDefined();
  });

  it('should define POST /queue for queue management', () => {
    const post = PROMPT_API_OPENAPI_DOCUMENT.paths['/queue'].post;
    expect(post).toBeDefined();
    expect(post.operationId).toBe('manageQueue');
  });

  it('should define GET /object_info response', () => {
    const response = PROMPT_API_OPENAPI_DOCUMENT.paths['/object_info'].get.responses['200'];
    expect(response).toBeDefined();
  });

  it('should define GET /object_info/{node_type}', () => {
    const get = PROMPT_API_OPENAPI_DOCUMENT.paths['/object_info/{node_type}'].get;
    expect(get).toBeDefined();
    expect(get.parameters[0].name).toBe('node_type');
    expect(get.parameters[0].in).toBe('path');
  });

  it('should define GET /system_stats', () => {
    const get = PROMPT_API_OPENAPI_DOCUMENT.paths['/system_stats'].get;
    expect(get).toBeDefined();
    expect(get.operationId).toBe('getSystemStats');
  });

  it('should define GET /history and /history/{prompt_id}', () => {
    expect(PROMPT_API_OPENAPI_DOCUMENT.paths['/history'].get).toBeDefined();
    const byId = PROMPT_API_OPENAPI_DOCUMENT.paths['/history/{prompt_id}'].get;
    expect(byId).toBeDefined();
    expect(byId.parameters[0].name).toBe('prompt_id');
  });
});
