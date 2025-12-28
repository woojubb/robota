import fs from 'fs';
import path from 'path';

import { createRequestHashFromSnapshot } from '../../dist/node/scenario/index.js';

/**
 * This script migrates older workflow scenario fixture files into the current v1 format:
 * - Adds explicit step.kind for provider steps
 * - Recomputes provider requestHash from the stored request snapshots
 * - Derives tool_result steps from explicit tool messages and toolCalls (no guessing)
 *
 * This is a one-time fixture migration helper. It must fail fast if required explicit
 * linkage information is missing.
 */

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[SCENARIO-MIGRATE] Expected object for ${label}`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[SCENARIO-MIGRATE] Expected non-empty string for ${label}`);
  }
  return value;
}

function assertNumber(value, label) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`[SCENARIO-MIGRATE] Expected number for ${label}`);
  }
  return value;
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function migrateRecord(record) {
  const obj = assertObject(record, 'record');
  assertString(obj.scenarioId, 'record.scenarioId');
  assertNumber(obj.version, 'record.version');
  if (!Array.isArray(obj.steps)) {
    throw new Error('[SCENARIO-MIGRATE] record.steps must be an array');
  }

  /** @type {Map<string, { toolName: string, toolArguments: string }>} */
  const toolCallIndex = new Map();
  /** @type {Array<{ toolCallId: string, toolMessageContent: string, timestamp: number }>} */
  const toolMessages = [];

  // Pass 1: normalize provider steps and build toolCall index + tool message list.
  for (const step of obj.steps) {
    const s = assertObject(step, 'step');

    // Older fixtures omitted "kind"; assume provider if it has request/response snapshots.
    if (!('kind' in s)) {
      if (s.request && s.response) {
        s.kind = 'provider';
      } else {
        throw new Error('[SCENARIO-MIGRATE] Missing step.kind and step is not a provider snapshot');
      }
    }

    if (s.kind !== 'provider') {
      // We only migrate provider-only fixtures here; anything else must be explicit.
      throw new Error(`[SCENARIO-MIGRATE] Unexpected step.kind "${s.kind}". Expected provider-only fixture input.`);
    }

    // Recompute requestHash from snapshot (SSOT: hash algorithm lives in scenario module).
    s.requestHash = createRequestHashFromSnapshot(s.request);

    // Index toolCalls from assistant response snapshots (explicit IDs + arguments).
    const response = assertObject(s.response, 'providerStep.response');
    const message = response.message ? assertObject(response.message, 'providerStep.response.message') : null;
    if (message && Array.isArray(message.toolCalls)) {
      for (const tc of message.toolCalls) {
        const tco = assertObject(tc, 'toolCall');
        const id = tco.id ? String(tco.id) : '';
        const name = tco.name ? String(tco.name) : '';
        const args = tco.arguments ? String(tco.arguments) : '';
        if (!id || !name) continue;
        toolCallIndex.set(id, { toolName: name, toolArguments: args });
      }
    }

    // Collect tool messages from subsequent provider requests (explicit toolCallId + content).
    const request = assertObject(s.request, 'providerStep.request');
    if (Array.isArray(request.messages)) {
      for (const m of request.messages) {
        const mo = assertObject(m, 'message');
        if (mo.role !== 'tool') continue;
        const toolCallId = assertString(mo.toolCallId, 'toolMessage.toolCallId');
        const toolMessageContent = assertString(mo.content, 'toolMessage.content');
        const timestamp = assertNumber(mo.timestamp, 'toolMessage.timestamp');
        toolMessages.push({ toolCallId, toolMessageContent, timestamp });
      }
    }
  }

  // Pass 2: derive tool_result steps from explicit tool messages.
  const existingToolCallIds = new Set(
    obj.steps
      .filter(s => s && typeof s === 'object' && s.kind === 'tool_result' && typeof s.toolCallId === 'string')
      .map(s => s.toolCallId)
  );

  /** @type {Array<any>} */
  const toolResultSteps = [];
  for (const tm of toolMessages) {
    if (existingToolCallIds.has(tm.toolCallId)) continue;
    const info = toolCallIndex.get(tm.toolCallId);
    if (!info) {
      throw new Error(`[SCENARIO-MIGRATE] Missing toolCall info for toolCallId="${tm.toolCallId}"`);
    }

    toolResultSteps.push({
      kind: 'tool_result',
      stepId: `tool_${tm.toolCallId}`,
      toolCallId: tm.toolCallId,
      toolName: info.toolName,
      toolArguments: info.toolArguments,
      toolMessageContent: tm.toolMessageContent,
      // For workflow guarded examples, tool returns a plain string which is also used as tool message content.
      resultData: tm.toolMessageContent,
      success: true,
      timestamp: tm.timestamp
    });
  }

  obj.steps.push(...toolResultSteps);
  return obj;
}

function main() {
  const examplesDir = path.resolve(process.cwd(), 'examples');
  const scenariosDir = path.join(examplesDir, 'scenarios');
  const files = ['mandatory-delegation.json', 'continued-conversation.json'];

  for (const file of files) {
    const p = path.join(scenariosDir, file);
    const record = loadJson(p);
    const migrated = migrateRecord(record);
    writeJson(p, migrated);
    process.stdout.write(`[SCENARIO-MIGRATE] Updated ${p}\n`);
  }
}

main();


