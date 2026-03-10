import { describe, expect, it } from 'vitest';
import {
    startDagServer,
    AssetAwareTaskExecutorPort,
    FileStoragePort,
    DagRunService,
    BundledNodeCatalogService,
    DAG_OPENAPI_DOCUMENT
} from '../index.js';

describe('index exports', () => {
    it('exports startDagServer as a function', () => {
        expect(typeof startDagServer).toBe('function');
    });

    it('exports AssetAwareTaskExecutorPort as a class', () => {
        expect(typeof AssetAwareTaskExecutorPort).toBe('function');
    });

    it('exports FileStoragePort as a class', () => {
        expect(typeof FileStoragePort).toBe('function');
    });

    it('exports DagRunService as a class', () => {
        expect(typeof DagRunService).toBe('function');
    });

    it('exports BundledNodeCatalogService as a class', () => {
        expect(typeof BundledNodeCatalogService).toBe('function');
    });

    it('exports DAG_OPENAPI_DOCUMENT as an object', () => {
        expect(typeof DAG_OPENAPI_DOCUMENT).toBe('object');
        expect(DAG_OPENAPI_DOCUMENT).not.toBeNull();
    });
});
