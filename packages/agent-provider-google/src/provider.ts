import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import type { IGoogleProviderOptions } from './types.js';

export class GoogleProvider extends GeminiProvider {
  override readonly name = 'google';

  constructor(options: IGoogleProviderOptions) {
    super(options);
  }
}
