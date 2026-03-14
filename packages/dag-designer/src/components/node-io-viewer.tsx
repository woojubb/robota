import { useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { IPortBinaryValue, TPortPayload, TPortValue } from '@robota-sdk/dag-core';

export interface INodeIoViewerProps {
    input?: TPortPayload;
    output?: TPortPayload;
    assetBaseUrl?: string;
}

function stringifyValue(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function isBinaryValue(value: TPortValue): value is IPortBinaryValue {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('kind' in value) || !('mimeType' in value) || !('uri' in value)) {
        return false;
    }
    return typeof value.kind === 'string'
        && typeof value.mimeType === 'string'
        && typeof value.uri === 'string';
}

function resolveRenderableUri(binary: IPortBinaryValue, assetBaseUrl?: string): string {
    if (binary.uri.startsWith('asset://') && assetBaseUrl) {
        const assetId = binary.assetId ?? binary.uri.replace('asset://', '');
        return `${assetBaseUrl}/view?filename=${encodeURIComponent(assetId)}`;
    }
    return binary.uri;
}

function renderPrimitive(value: string | number | boolean | null): ReactElement {
    if (typeof value === 'string') {
        return <div className="whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px]">{value}</div>;
    }
    return <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px]">{String(value)}</div>;
}

function renderBinary(
    binary: IPortBinaryValue,
    assetBaseUrl: string | undefined,
    onImageClick: (imageUri: string) => void
): ReactElement {
    const resolvedUri = resolveRenderableUri(binary, assetBaseUrl);
    const isImage = binary.kind === 'image';
    const isVideo = binary.kind === 'video';
    return (
        <div className="flex flex-col gap-1 rounded border border-gray-200 bg-gray-50 p-2">
            <div className="text-[10px] text-gray-600">{binary.kind} · {binary.mimeType}</div>
            {isImage ? (
                <button
                    type="button"
                    className="rounded border border-gray-300 bg-white p-1"
                    onClick={() => onImageClick(resolvedUri)}
                >
                    <img
                        src={resolvedUri}
                        alt="Node output preview"
                        className="max-h-40 w-full rounded object-contain"
                    />
                </button>
            ) : null}
            {isVideo ? (
                <div className="rounded border border-gray-300 bg-black p-1">
                    <video
                        controls
                        preload="metadata"
                        className="max-h-56 w-full rounded object-contain"
                    >
                        <source src={resolvedUri} type={binary.mimeType} />
                    </video>
                </div>
            ) : null}
            <a href={resolvedUri} target="_blank" rel="noreferrer" className="break-all text-[10px] text-blue-600 underline">
                {binary.uri}
            </a>
        </div>
    );
}

function renderValue(
    value: TPortValue,
    assetBaseUrl: string | undefined,
    onImageClick: (imageUri: string) => void
): ReactElement {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return renderPrimitive(value);
    }
    if (isBinaryValue(value)) {
        return renderBinary(value, assetBaseUrl, onImageClick);
    }
    if (Array.isArray(value)) {
        return (
            <details className="rounded border border-gray-200 bg-gray-50 p-2">
                <summary className="cursor-pointer text-[10px] text-gray-700">array[{value.length}]</summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] text-gray-700">{stringifyValue(value)}</pre>
            </details>
        );
    }
    return (
        <details className="rounded border border-gray-200 bg-gray-50 p-2">
            <summary className="cursor-pointer text-[10px] text-gray-700">object</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] text-gray-700">{stringifyValue(value)}</pre>
        </details>
    );
}

function renderPayload(
    title: string,
    payload: TPortPayload | undefined,
    assetBaseUrl: string | undefined,
    onImageClick: (imageUri: string) => void
): ReactElement {
    return (
        <div className="flex flex-col gap-1">
            <div className="text-[10px] font-semibold text-gray-600">{title}</div>
            {!payload || Object.keys(payload).length === 0 ? (
                <div className="text-[10px] text-gray-400">No data</div>
            ) : (
                Object.entries(payload).map(([key, value]) => (
                    <div key={`${title}-${key}`} className="rounded border border-gray-200 bg-white p-2">
                        <div className="mb-1 text-[10px] font-medium text-gray-700">{key}</div>
                        {renderValue(value, assetBaseUrl, onImageClick)}
                    </div>
                ))
            )}
        </div>
    );
}

export function NodeIoViewer(props: INodeIoViewerProps): ReactElement {
    const [popupImageUri, setPopupImageUri] = useState<string | undefined>(undefined);
    const hasDom = typeof document !== 'undefined';

    return (
        <div className="nodrag border-t border-gray-200 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold text-gray-600">Node I/O Viewer</div>
            <div className="grid grid-cols-1 gap-2">
                {renderPayload('Output', props.output, props.assetBaseUrl, setPopupImageUri)}
            </div>
            {popupImageUri && hasDom ? createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
                    onClick={() => setPopupImageUri(undefined)}
                >
                    <div
                        className="fixed bottom-[100px] left-[100px] right-[100px] top-[100px] flex min-h-0 flex-col rounded border border-gray-300 bg-white p-3"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-semibold text-gray-700">Image Viewer</div>
                            <button
                                type="button"
                                className="rounded border border-gray-300 px-2 py-1 text-[11px] hover:bg-gray-50"
                                onClick={() => setPopupImageUri(undefined)}
                            >
                                Close
                            </button>
                        </div>
                        <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-gray-200 bg-gray-50">
                            <img
                                src={popupImageUri}
                                alt="Node IO popup preview"
                                className="max-h-full max-w-full object-contain"
                            />
                        </div>
                    </div>
                </div>,
                document.body
            ) : null}
        </div>
    );
}
