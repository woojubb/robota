/**
 * The editor's file system, as the editor offered it in `initialize`: reads and writes the host's
 * file tools may hand to it once the session is bound. The tools decide what they touch; this only
 * carries the access, so it never widens what a tool may reach.
 */

import { isAbsolute } from 'node:path';

import { RequestError } from '@agentclientprotocol/sdk';

import type { IAcpEditorFileAccess } from './acp-types.js';
import type { AgentContext, ClientCapabilities, SendRequestOptions } from '@agentclientprotocol/sdk';

function cancellable(signal: AbortSignal | undefined): SendRequestOptions | undefined {
  return signal === undefined ? undefined : { cancellationSignal: signal };
}

/** A JSON-RPC error names its kind in `message` and, from an SDK client, the cause in `data.details`. */
function editorError(error: unknown): Error {
  if (!(error instanceof RequestError)) return error instanceof Error ? error : new Error(String(error));
  const data: unknown = error.data;
  const details =
    typeof data === 'object' && data !== null && 'details' in data && typeof data.details === 'string'
      ? data.details
      : undefined;
  return new Error(details === undefined ? error.message : `${error.message}: ${details}`);
}

function absolute(path: string): void {
  // ACP names files by absolute path; a relative one would be resolved by the editor, not the tool.
  if (!isAbsolute(path)) throw new Error(`the editor is given absolute paths only: ${path}`);
}

/**
 * The access the editor offered, for the bound session; `undefined` when it offered neither read nor
 * write. `sessionId` is read at each request, so the access follows the session the connection serves.
 */
export function editorFileAccess(
  fs: ClientCapabilities['fs'],
  client: AgentContext,
  sessionId: () => string | undefined,
): IAcpEditorFileAccess | undefined {
  const reads = fs?.readTextFile === true;
  const writes = fs?.writeTextFile === true;
  if (!reads && !writes) return undefined;
  const bound = (): string => {
    const id = sessionId();
    if (id === undefined) throw new Error('the editor has no session to read or write for');
    return id;
  };
  return {
    ...(reads
      ? {
          readTextFile: async (path: string, signal?: AbortSignal): Promise<string> => {
            absolute(path);
            try {
              const reply = await client.request(
                'fs/read_text_file',
                { sessionId: bound(), path },
                cancellable(signal),
              );
              return reply.content;
            } catch (error) {
              throw editorError(error);
            }
          },
        }
      : {}),
    ...(writes
      ? {
          writeTextFile: async (path: string, content: string, signal?: AbortSignal): Promise<void> => {
            absolute(path);
            try {
              await client.request(
                'fs/write_text_file',
                { sessionId: bound(), path, content },
                cancellable(signal),
              );
            } catch (error) {
              throw editorError(error);
            }
          },
        }
      : {}),
  };
}
