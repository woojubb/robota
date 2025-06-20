export interface Logger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}

export class SimpleLoggerImpl implements Logger {
    private prefix: string;

    constructor(prefix: string = 'SessionSDK') {
        this.prefix = prefix;
    }

    debug(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.debug(`[${this.prefix}:DEBUG] ${message}`, ...args);
    }

    info(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.info(`[${this.prefix}:INFO] ${message}`, ...args);
    }

    warn(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.warn(`[${this.prefix}:WARN] ${message}`, ...args);
    }

    error(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.error(`[${this.prefix}:ERROR] ${message}`, ...args);
    }
} 