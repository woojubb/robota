/**
 * Platform-neutral IPayloadLogger implementations. The file logger is Node-only (`./node`).
 */

// Interfaces
export type { IPayloadLogger, IPayloadLoggerOptions } from '../interfaces/payload-logger';

export { ConsolePayloadLogger } from './console-payload-logger';
