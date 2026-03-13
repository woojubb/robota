import { describe, it, expect, vi } from 'vitest';
import {
    validateModule,
    validateModuleDependencies,
    findDependentModules,
    buildRegistryStats
} from './module-registry-validation';
import { ModuleDescriptorRegistry } from './module-type-registry';
import { ModuleCategory, ModuleLayer } from '../abstracts/abstract-module';
import { ConfigurationError } from '../utils/errors';
import type { IModule } from '../abstracts/abstract-module';
import type { ILogger } from '../utils/logger';

function mockLogger(): ILogger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
}

function createMockModule(overrides: Partial<IModule> = {}): IModule {
    return {
        name: 'test-module',
        version: '1.0.0',
        enabled: true,
        initialized: false,
        getModuleType: () => ({
            type: 'test',
            category: ModuleCategory.CORE,
            layer: ModuleLayer.APPLICATION
        }),
        isEnabled: () => true,
        isInitialized: () => false,
        initialize: vi.fn(),
        ...overrides
    } as any;
}

describe('module-registry-validation', () => {
    const logger = mockLogger();

    describe('validateModule', () => {
        it('passes for a valid module', () => {
            const registry = new ModuleDescriptorRegistry();
            registry.registerType({
                type: 'test',
                category: ModuleCategory.CORE,
                layer: ModuleLayer.APPLICATION
            });
            const module = createMockModule();
            expect(() => validateModule(module, registry, logger)).not.toThrow();
        });

        it('throws for empty name', () => {
            const registry = new ModuleDescriptorRegistry();
            const module = createMockModule({ name: '' });
            expect(() => validateModule(module, registry, logger))
                .toThrow(ConfigurationError);
        });

        it('throws for empty version', () => {
            const registry = new ModuleDescriptorRegistry();
            const module = createMockModule({ version: '' });
            expect(() => validateModule(module, registry, logger))
                .toThrow(ConfigurationError);
        });
    });

    describe('validateModuleDependencies', () => {
        it('passes when no dependencies', async () => {
            const registry = new ModuleDescriptorRegistry();
            const module = createMockModule();
            const modules = new Map<string, IModule>();
            await expect(
                validateModuleDependencies(module, registry, modules, logger)
            ).resolves.toBeUndefined();
        });

        it('throws when dependency type not registered', async () => {
            const registry = new ModuleDescriptorRegistry();
            registry.registerType({
                type: 'test-with-dep',
                category: ModuleCategory.CORE,
                layer: ModuleLayer.APPLICATION,
                dependencies: ['nonexistent-type']
            });
            const module = createMockModule({
                getModuleType: () => ({
                    type: 'test-with-dep',
                    category: ModuleCategory.CORE,
                    layer: ModuleLayer.APPLICATION,
                    dependencies: ['nonexistent-type']
                })
            });
            await expect(
                validateModuleDependencies(module, registry, new Map(), logger)
            ).rejects.toThrow(ConfigurationError);
        });
    });

    describe('findDependentModules', () => {
        it('returns empty when no dependents', () => {
            const modules = new Map<string, IModule>();
            modules.set('a', createMockModule({ name: 'a' }));
            expect(findDependentModules('a', modules)).toEqual([]);
        });

        it('returns empty when module not found', () => {
            expect(findDependentModules('missing', new Map())).toEqual([]);
        });

        it('finds dependents', () => {
            const modules = new Map<string, IModule>();
            modules.set('dep', createMockModule({
                name: 'dep',
                getModuleType: () => ({
                    type: 'dep-type',
                    category: ModuleCategory.CORE,
                    layer: ModuleLayer.APPLICATION
                })
            }));
            modules.set('consumer', createMockModule({
                name: 'consumer',
                getModuleType: () => ({
                    type: 'consumer-type',
                    category: ModuleCategory.CORE,
                    layer: ModuleLayer.APPLICATION,
                    dependencies: ['dep-type']
                })
            }));
            expect(findDependentModules('dep', modules)).toEqual(['consumer']);
        });
    });

    describe('buildRegistryStats', () => {
        it('returns zeroed stats for empty registry', () => {
            const stats = buildRegistryStats(new Map(), new Map());
            expect(stats.totalModules).toBe(0);
            expect(stats.totalExecutions).toBe(0);
        });

        it('aggregates module and execution stats', () => {
            const modules = new Map<string, IModule>();
            modules.set('a', createMockModule({
                name: 'a',
                isInitialized: () => true,
                isEnabled: () => true
            }));
            modules.set('b', createMockModule({
                name: 'b',
                isInitialized: () => false,
                isEnabled: () => false
            }));

            const moduleStats = new Map();
            moduleStats.set('a', {
                totalExecutions: 10,
                successfulExecutions: 8,
                failedExecutions: 2,
                totalExecutionTime: 5000,
                averageExecutionTime: 500
            });

            const stats = buildRegistryStats(modules, moduleStats);
            expect(stats.totalModules).toBe(2);
            expect(stats.initializedModules).toBe(1);
            expect(stats.enabledModules).toBe(1);
            expect(stats.totalExecutions).toBe(10);
            expect(stats.totalSuccessfulExecutions).toBe(8);
            expect(stats.totalFailedExecutions).toBe(2);
            expect(stats.averageExecutionTime).toBe(500);
        });
    });
});
