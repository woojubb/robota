import { describe, expect, it } from 'vitest';
import type {
  IDagDefinition,
  INodeObjectInfo,
  TInputTypeSpec,
  TObjectInfo,
} from '@robota-sdk/dag-core';
import { buildDagChatDraft } from '../dag-chat-draft';

function createBlankDefinition(): IDagDefinition {
  return {
    dagId: 'draft',
    version: 1,
    status: 'draft',
    nodes: [],
    edges: [],
    costPolicy: {
      runCreditLimit: 100,
      costPolicyVersion: 2,
    },
  };
}

function createObjectInfo(input: {
  displayName: string;
  category: string;
  required?: Record<string, TInputTypeSpec>;
  optional?: Record<string, TInputTypeSpec>;
  output?: string[];
  outputName?: string[];
  description?: string;
}): INodeObjectInfo {
  const output = input.output ?? [];
  return {
    display_name: input.displayName,
    category: input.category,
    input: {
      required: input.required ?? {},
      optional: input.optional,
    },
    output,
    output_is_list: output.map(() => false),
    output_name: input.outputName ?? output.map((entry) => entry.toLowerCase()),
    output_node: false,
    description: input.description ?? input.displayName,
  };
}

const TEST_OBJECT_INFO: TObjectInfo = {
  'image-source': createObjectInfo({
    displayName: 'Image Source',
    category: 'Media',
    output: ['IMAGE'],
    outputName: ['image'],
  }),
  input: createObjectInfo({
    displayName: 'Input',
    category: 'Core',
    output: ['STRING'],
    outputName: ['text'],
  }),
  'gemini-image-compose': createObjectInfo({
    displayName: 'Gemini Image Compose',
    category: 'AI',
    required: {
      images: ['IMAGE'],
      prompt: ['STRING'],
    },
    output: ['IMAGE'],
    outputName: ['image'],
  }),
  'gemini-image-edit': createObjectInfo({
    displayName: 'Gemini Image Edit',
    category: 'AI',
    required: {
      image: ['IMAGE'],
      prompt: ['STRING'],
    },
    output: ['IMAGE'],
    outputName: ['image'],
  }),
  'seedance-video': createObjectInfo({
    displayName: 'Seedance Video',
    category: 'AI',
    required: {
      prompt: ['STRING'],
    },
    optional: {
      images: ['IMAGE'],
    },
    output: ['VIDEO'],
    outputName: ['video'],
  }),
};

describe('buildDagChatDraft', () => {
  it('does not modify the definition when the prompt is empty', () => {
    const definition = createBlankDefinition();

    const result = buildDagChatDraft({
      prompt: '   ',
      definition,
      objectInfo: TEST_OBJECT_INFO,
    });

    expect(result.status).toBe('empty-prompt');
    expect(result.definition).toBe(definition);
    expect(result.addedNodeIds).toEqual([]);
  });

  it('requires a node catalog before building a draft', () => {
    const definition = createBlankDefinition();

    const result = buildDagChatDraft({
      prompt: '두 이미지를 합성해서 비디오를 만들어줘',
      definition,
      objectInfo: {},
    });

    expect(result.status).toBe('needs-catalog');
    expect(result.definition).toBe(definition);
    expect(result.warnings[0]?.code).toBe('DAG_CHAT_CATALOG_REQUIRED');
  });

  it('creates a compose-to-video DAG draft from catalog-confirmed nodes', () => {
    const result = buildDagChatDraft({
      prompt: '두 이미지를 합성해서 비디오를 만들어줘',
      definition: createBlankDefinition(),
      objectInfo: TEST_OBJECT_INFO,
    });

    expect(result.status).toBe('applied');
    expect(result.addedNodeIds).toEqual([
      'image_source_1',
      'image_source_2',
      'compose_prompt_1',
      'video_prompt_1',
      'gemini_image_compose_1',
      'seedance_video_1',
    ]);
    expect(result.definition.nodes.map((node) => node.nodeType)).toEqual([
      'image-source',
      'image-source',
      'input',
      'input',
      'gemini-image-compose',
      'seedance-video',
    ]);
    expect(result.definition.edges).toEqual([
      {
        from: 'image_source_1',
        to: 'gemini_image_compose_1',
        bindings: [{ outputKey: 'image', inputKey: 'images[0]' }],
      },
      {
        from: 'image_source_2',
        to: 'gemini_image_compose_1',
        bindings: [{ outputKey: 'image', inputKey: 'images[1]' }],
      },
      {
        from: 'compose_prompt_1',
        to: 'gemini_image_compose_1',
        bindings: [{ outputKey: 'text', inputKey: 'prompt' }],
      },
      {
        from: 'gemini_image_compose_1',
        to: 'seedance_video_1',
        bindings: [{ outputKey: 'image', inputKey: 'images[0]' }],
      },
      {
        from: 'video_prompt_1',
        to: 'seedance_video_1',
        bindings: [{ outputKey: 'text', inputKey: 'prompt' }],
      },
    ]);
    expect(
      result.definition.nodes.find((node) => node.nodeId === 'seedance_video_1')?.dependsOn,
    ).toEqual(['gemini_image_compose_1', 'video_prompt_1']);
    expect(result.definition.nodes.every((node) => !node.inputs && !node.outputs)).toBe(true);
  });

  it('returns no-plan when the catalog has no usable node chain', () => {
    const result = buildDagChatDraft({
      prompt: 'make a video from two images',
      definition: createBlankDefinition(),
      objectInfo: {
        noise: createObjectInfo({
          displayName: 'Noise',
          category: 'Utility',
          output: ['NOISE'],
        }),
      },
    });

    expect(result.status).toBe('no-plan');
    expect(result.addedNodeIds).toEqual([]);
    expect(result.definition.nodes).toEqual([]);
  });
});
