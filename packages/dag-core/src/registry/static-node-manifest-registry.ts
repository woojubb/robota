import type { INodeManifest } from '../types/domain.js';
import type { INodeManifestRegistry } from '../types/node-lifecycle.js';

const DEFAULT_MANIFESTS: INodeManifest[] = [
    {
        nodeType: 'input',
        displayName: 'Input',
        category: 'Core',
        inputs: [],
        outputs: [
            { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
            { key: 'data', label: 'Data', order: 1, type: 'object', required: false }
        ],
        configSchema: '{"type":"object","properties":{}}'
    },
    {
        nodeType: 'transform',
        displayName: 'Transform',
        category: 'Core',
        inputs: [
            { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
            { key: 'data', label: 'Data', order: 1, type: 'object', required: false }
        ],
        outputs: [
            { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
            { key: 'data', label: 'Data', order: 1, type: 'object', required: false }
        ],
        configSchema: '{"type":"object","properties":{"prefix":{"type":"string"}}}'
    },
    {
        nodeType: 'llm-text',
        displayName: 'LLM Text',
        category: 'AI',
        inputs: [
            { key: 'prompt', label: 'Prompt', order: 0, type: 'string', required: true }
        ],
        outputs: [
            { key: 'completion', label: 'Completion', order: 0, type: 'string', required: true }
        ],
        configSchema: '{"type":"object","properties":{"model":{"type":"string"},"baseCostUsd":{"type":"number"}}}'
    },
    {
        nodeType: 'image-loader',
        displayName: 'Image Loader',
        category: 'Media',
        inputs: [
            { key: 'uri', label: 'Source URI', order: 0, type: 'string', required: true }
        ],
        outputs: [
            {
                key: 'image',
                label: 'Image',
                order: 0,
                type: 'binary',
                required: true,
                binaryKind: 'image',
                mimeTypes: ['image/png', 'image/jpeg', 'image/webp']
            }
        ],
        configSchema: '{"type":"object","properties":{}}'
    }
];

export class StaticNodeManifestRegistry implements INodeManifestRegistry {
    private readonly manifestByType = new Map<string, INodeManifest>();

    public constructor(manifests: INodeManifest[] = DEFAULT_MANIFESTS) {
        for (const manifest of manifests) {
            this.manifestByType.set(manifest.nodeType, manifest);
        }
    }

    public getManifest(nodeType: string): INodeManifest | undefined {
        return this.manifestByType.get(nodeType);
    }

    public listManifests(): INodeManifest[] {
        return [...this.manifestByType.values()];
    }
}

export function createDefaultNodeManifestRegistry(): StaticNodeManifestRegistry {
    return new StaticNodeManifestRegistry();
}
