export const QWEN_PROVIDER_BASE_URLS = {
  singapore: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  usVirginia: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  beijing: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  hongKong: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
} as const;

export type TQwenProviderRegion = keyof typeof QWEN_PROVIDER_BASE_URLS;

export const QWEN_PROVIDER_RESPONSES_BASE_URLS = {
  singapore: 'https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
  usVirginia: 'https://dashscope-us.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
  beijing: 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
} as const;

export type TQwenProviderResponsesRegion = keyof typeof QWEN_PROVIDER_RESPONSES_BASE_URLS;

export const DEFAULT_QWEN_PROVIDER_MODEL = 'qwen-plus';
export const DEFAULT_QWEN_PROVIDER_API_KEY_ENV = 'DASHSCOPE_API_KEY';
export const DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE = `$ENV:${DEFAULT_QWEN_PROVIDER_API_KEY_ENV}`;
export const DEFAULT_QWEN_PROVIDER_BASE_URL = QWEN_PROVIDER_BASE_URLS.singapore;
export const DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL = QWEN_PROVIDER_RESPONSES_BASE_URLS.singapore;

export const QWEN_MODEL_SOURCE_URL =
  'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope';
export const QWEN_MODEL_LAST_VERIFIED_AT = '2026-05-04';
