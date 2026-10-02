import { publicProductConfig } from '@robota-sdk/product-config';
import { loadProductConfig } from '@robota-sdk/product-config/node';

import type { IPublicProductConfig, TConfigEnvironment } from '@robota-sdk/product-config';

/** Source development requires explicit config; the generator replaces this loader in staged builds. */
export function loadWebProductConfig(environment: TConfigEnvironment): IPublicProductConfig {
  return publicProductConfig(loadProductConfig({ environment }));
}
