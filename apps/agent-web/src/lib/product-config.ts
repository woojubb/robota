import { publicProductConfig } from '@robota-sdk/product-config';
import { loadProductConfig } from '@robota-sdk/product-config/node';

import { isProductBuildConfig, productPublicConfig as generatedProductConfig } from './product-config.generated';

import type { IPublicProductConfig, TConfigEnvironment } from '@robota-sdk/product-config';

/** Staged builds use their fixed generated public projection; source development requires explicit config. */
export function loadWebProductConfig(environment: TConfigEnvironment): IPublicProductConfig {
  if (isProductBuildConfig) {
    if (generatedProductConfig === undefined) {
      throw new Error('Generated web product configuration is missing.');
    }
    return generatedProductConfig as IPublicProductConfig;
  }
  return publicProductConfig(loadProductConfig({ environment }));
}
