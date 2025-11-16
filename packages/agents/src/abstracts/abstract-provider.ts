/**
 * @fileoverview Abstract Provider Base Class
 *
 * 🎯 ABSTRACT CLASS - DO NOT DEPEND ON CONCRETE IMPLEMENTATIONS
 *
 * Minimal lifecycle contract for shared provider utilities (non-AI specific).
 */
import type { SimpleLogger } from '../utils/simple-logger';
import { DEFAULT_ABSTRACT_LOGGER } from '../utils/abstract-logger';

export abstract class AbstractProvider {
    abstract readonly name: string;

    protected initialized = false;
    protected readonly logger: SimpleLogger;

    constructor(logger: SimpleLogger = DEFAULT_ABSTRACT_LOGGER) {
        this.logger = logger;
    }

    async initialize(): Promise<void> {
        this.initialized = true;
    }

    async dispose(): Promise<void> {
        this.initialized = false;
    }

    isInitialized(): boolean {
        return this.initialized;
    }
}