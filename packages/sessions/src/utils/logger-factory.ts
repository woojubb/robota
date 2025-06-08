import { SimpleLoggerImpl, Logger } from './simple-logger';

export class LoggerFactory {
    private static instances: Map<string, Logger> = new Map();

    static getLogger(name: string): Logger {
        if (!this.instances.has(name)) {
            this.instances.set(name, new SimpleLoggerImpl(name));
        }
        return this.instances.get(name)!;
    }

    static createLogger(name: string): Logger {
        return new SimpleLoggerImpl(name);
    }

    static clearCache(): void {
        this.instances.clear();
    }
} 