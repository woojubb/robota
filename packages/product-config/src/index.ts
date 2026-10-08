export {
  PRODUCT_CONFIG_DESCRIPTORS,
  PRODUCT_CONFIG_FILE_VARIABLE,
  ProductConfigError,
  generateDefaultEnvironment,
  productConfigEntries,
  productSettingAlias,
} from './contract.js';
export type {
  IEmbeddedProductIdentity,
  IHostProductConfig,
  IProductConfig,
  IProductConfigEntry,
  IProductSetting,
  IPublicProductConfig,
  TConfigConsumer,
  TConfigEnvironment,
  TConfigExposure,
  TConfigPhase,
} from './contract.js';
export {
  embeddedProductIdentity,
  hostProductConfig,
  parsePublicProductConfig,
  publicProductConfig,
  resolveProductConfig,
} from './resolve.js';
export type { IResolveProductConfigOptions } from './resolve.js';

export { scopeProductEnvironment } from './environment.js';
export { embeddedProductRuntimeDefaults, parseProductRuntimeDefaults } from './runtime-defaults.js';
