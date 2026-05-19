export type TSseEventType =
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'text_delta'
  | 'done'
  | 'error'
  | 'agent_job_created'
  | 'agent_job_started'
  | 'agent_job_text_delta'
  | 'agent_job_tool_start'
  | 'agent_job_tool_end'
  | 'agent_job_completed'
  | 'agent_job_failed';

export interface ISseToolCallStart {
  type: 'tool_call_start';
  data: { id: string; name: string; input: Record<string, unknown> };
}

export interface ISseToolCallComplete {
  type: 'tool_call_complete';
  data: { id: string; output: unknown };
}

export interface ISseTextDelta {
  type: 'text_delta';
  data: { text: string };
}

export interface ISseDone {
  type: 'done';
  data: { usage: { promptTokens: number; completionTokens: number; totalTokens: number } };
}

export interface ISseError {
  type: 'error';
  data: { message: string };
}

export interface ISseAgentJobCreated {
  type: 'agent_job_created';
  data: {
    taskId: string;
    label: string;
    agentType: string;
    promptPreview?: string;
    originToolCallId?: string;
  };
}

export interface ISseAgentJobStarted {
  type: 'agent_job_started';
  data: { taskId: string };
}

export interface ISseAgentJobTextDelta {
  type: 'agent_job_text_delta';
  data: { taskId: string; delta: string };
}

export interface ISseAgentJobToolStart {
  type: 'agent_job_tool_start';
  data: { taskId: string; toolName: string; firstArg?: string };
}

export interface ISseAgentJobToolEnd {
  type: 'agent_job_tool_end';
  data: { taskId: string; toolName: string; success: boolean };
}

export interface ISseAgentJobCompleted {
  type: 'agent_job_completed';
  data: { taskId: string; label: string; agentType?: string };
}

export interface ISseAgentJobFailed {
  type: 'agent_job_failed';
  data: { taskId: string; label: string };
}

export type TSseEvent =
  | ISseToolCallStart
  | ISseToolCallComplete
  | ISseTextDelta
  | ISseDone
  | ISseError
  | ISseAgentJobCreated
  | ISseAgentJobStarted
  | ISseAgentJobTextDelta
  | ISseAgentJobToolStart
  | ISseAgentJobToolEnd
  | ISseAgentJobCompleted
  | ISseAgentJobFailed;

export interface ISseExecuteRequest {
  provider: string;
  model: string;
  tools?: string[];
  systemPrompt?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ISessionSkill {
  id: string;
  name: string;
  description: string;
  skillMdContent: string;
}

export interface ISessionCreateRequest {
  provider: string;
  model: string;
  systemPrompt?: string;
  permissionMode?: string;
  maxTurns?: number;
  skills?: ISessionSkill[];
  resumeSessionId?: string;
}

export interface IRestoredMessage {
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
}

export interface ISessionCreateResponse {
  sessionId: string;
  messages?: IRestoredMessage[];
}

export interface ISessionSummary {
  id: string;
  name?: string;
  cwd: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

function buildBaseUrl(serverUrl: string): string {
  return serverUrl
    .replace(/^wss/, 'https')
    .replace(/^ws/, 'http')
    .replace(/\/ws\/playground$/, '')
    .replace(/\/ws$/, '');
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-Provider-API-Key'] = apiKey;
  }
  return headers;
}

export async function* sseExecute(
  serverUrl: string,
  apiKey: string | undefined,
  body: ISseExecuteRequest,
): AsyncGenerator<TSseEvent> {
  const baseUrl = buildBaseUrl(serverUrl);
  const resp = await fetch(`${baseUrl}/api/playground/execute`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => 'Unknown error'); // allow-fallback: http error body read is best-effort
    throw new Error(`SSE request failed (${resp.status}): ${text}`);
  }

  yield* readSseStream(resp.body);
}

export async function createSession(
  serverUrl: string,
  apiKey: string | undefined,
  body: ISessionCreateRequest,
): Promise<ISessionCreateResponse> {
  const baseUrl = buildBaseUrl(serverUrl);
  const resp = await fetch(`${baseUrl}/api/playground/sessions`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'Unknown error'); // allow-fallback: http error body read is best-effort
    throw new Error(`Session create failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<ISessionCreateResponse>;
}

export async function* sseSessionSubmit(
  serverUrl: string,
  apiKey: string | undefined,
  sessionId: string,
  message: string,
): AsyncGenerator<TSseEvent> {
  const baseUrl = buildBaseUrl(serverUrl);
  const resp = await fetch(`${baseUrl}/api/playground/sessions/${sessionId}/submit`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ message }),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => 'Unknown error'); // allow-fallback: http error body read is best-effort
    throw new Error(`Session submit failed (${resp.status}): ${text}`);
  }

  yield* readSseStream(resp.body);
}

export async function destroySession(
  serverUrl: string,
  apiKey: string | undefined,
  sessionId: string,
): Promise<void> {
  const baseUrl = buildBaseUrl(serverUrl);
  await fetch(`${baseUrl}/api/playground/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: buildHeaders(apiKey),
  });
}

export async function fetchSessions(
  serverUrl: string,
  apiKey: string | undefined,
): Promise<ISessionSummary[]> {
  const baseUrl = buildBaseUrl(serverUrl);
  const resp = await fetch(`${baseUrl}/api/playground/sessions`, {
    headers: buildHeaders(apiKey),
  });
  if (!resp.ok) return [];
  return resp.json() as Promise<ISessionSummary[]>;
}

async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<TSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const raw = JSON.parse(trimmed.slice('data: '.length)) as TSseEvent; // allow-any: SSE wire protocol cast
        yield raw;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
