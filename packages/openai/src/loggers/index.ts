/**
 * PayloadLogger implementations for different environments
 */

// Interfaces
export type { PayloadLogger, PayloadLoggerOptions } from '../interfaces/payload-logger';

// Node.js implementation
export { FilePayloadLogger } from './file-payload-logger';

// Browser implementation  
export { ConsolePayloadLogger } from './console-payload-logger'; 