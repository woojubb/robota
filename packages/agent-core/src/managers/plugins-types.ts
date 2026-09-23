/**
 * Shared type definitions for the Plugins manager and its helpers.
 *
 * Extracted so `plugins.ts` and `plugins-helpers.ts` can both depend on these types
 * without importing from one another (avoids a module-level import cycle).
 * @internal
 */
import type { AbstractPlugin } from '../abstracts/abstract-plugin';

/** Plugin lifecycle events */
export interface IPluginLifecycleEvents {
  beforeInitialize?: (plugin: AbstractPlugin) => Promise<void> | void;
  afterInitialize?: (plugin: AbstractPlugin) => Promise<void> | void;
  beforeDestroy?: (plugin: AbstractPlugin) => Promise<void> | void;
  afterDestroy?: (plugin: AbstractPlugin) => Promise<void> | void;
  onError?: (plugin: AbstractPlugin, error: Error) => Promise<void> | void;
}

/** Plugin dependency definition */
export interface IPluginDependency {
  name: string;
  required: boolean;
  minVersion?: string;
}

/** Plugin registration options */
export interface IPluginRegistrationOptions {
  dependencies?: IPluginDependency[];
  priority?: number;
  autoInitialize?: boolean;
}
