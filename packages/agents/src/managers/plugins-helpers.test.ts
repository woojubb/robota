import { describe, it, expect, vi } from 'vitest';
import { validateDependenciesHelper, resolveDependencyOrderHelper } from './plugins-helpers';
import { AbstractPlugin, PluginCategory, PluginPriority } from '../abstracts/abstract-plugin';
import { ConfigurationError } from '../utils/errors';

class FakePlugin extends AbstractPlugin {
    name: string;
    version: string;

    constructor(name: string, version: string = '1.0.0') {
        super();
        this.name = name;
        this.version = version;
        this.category = PluginCategory.MONITORING;
        this.priority = PluginPriority.NORMAL;
    }
}

describe('plugins-helpers', () => {
    describe('validateDependenciesHelper', () => {
        it('passes when all required dependencies exist', async () => {
            const plugins = new Map<string, AbstractPlugin>();
            plugins.set('dep-a', new FakePlugin('dep-a'));
            await expect(
                validateDependenciesHelper([{ name: 'dep-a', required: true }], plugins)
            ).resolves.toBeUndefined();
        });

        it('throws when required dependency is missing', async () => {
            const plugins = new Map<string, AbstractPlugin>();
            await expect(
                validateDependenciesHelper([{ name: 'missing', required: true }], plugins)
            ).rejects.toThrow(ConfigurationError);
        });

        it('allows missing optional dependency', async () => {
            const plugins = new Map<string, AbstractPlugin>();
            await expect(
                validateDependenciesHelper([{ name: 'optional', required: false }], plugins)
            ).resolves.toBeUndefined();
        });

        it('throws when dependency version is too low', async () => {
            const plugins = new Map<string, AbstractPlugin>();
            plugins.set('dep-a', new FakePlugin('dep-a', '1.0.0'));
            await expect(
                validateDependenciesHelper(
                    [{ name: 'dep-a', required: true, minVersion: '2.0.0' }],
                    plugins
                )
            ).rejects.toThrow(ConfigurationError);
        });

        it('passes when dependency version meets minimum', async () => {
            const plugins = new Map<string, AbstractPlugin>();
            plugins.set('dep-a', new FakePlugin('dep-a', '2.0.0'));
            await expect(
                validateDependenciesHelper(
                    [{ name: 'dep-a', required: true, minVersion: '1.5.0' }],
                    plugins
                )
            ).resolves.toBeUndefined();
        });
    });

    describe('resolveDependencyOrderHelper', () => {
        it('returns plugins in priority order when no dependencies', () => {
            const pluginOptions = new Map<string, any>();
            pluginOptions.set('a', { priority: 1 });
            pluginOptions.set('b', { priority: 10 });
            pluginOptions.set('c', { priority: 5 });
            const order = resolveDependencyOrderHelper(['a', 'b', 'c'], pluginOptions);
            expect(order).toContain('a');
            expect(order).toContain('b');
            expect(order).toContain('c');
        });

        it('resolves dependencies before dependents', () => {
            const pluginOptions = new Map<string, any>();
            pluginOptions.set('a', { dependencies: [{ name: 'b', required: true }], priority: 0 });
            pluginOptions.set('b', { priority: 0 });
            const order = resolveDependencyOrderHelper(['a', 'b'], pluginOptions);
            expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
        });

        it('throws on circular dependencies', () => {
            const pluginOptions = new Map<string, any>();
            pluginOptions.set('a', { dependencies: [{ name: 'b', required: true }], priority: 0 });
            pluginOptions.set('b', { dependencies: [{ name: 'a', required: true }], priority: 0 });
            expect(() => resolveDependencyOrderHelper(['a', 'b'], pluginOptions))
                .toThrow(ConfigurationError);
        });
    });
});
