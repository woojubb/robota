export const QWEN_PROVIDER_BASE_URLS = {
  singapore: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  usVirginia: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  beijing: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  hongKong: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
} as const;

export type TQwenProviderRegion = keyof typeof QWEN_PROVIDER_BASE_URLS;

export const DEFAULT_QWEN_PROVIDER_MODEL = 'qwen-plus';
export const DEFAULT_QWEN_PROVIDER_API_KEY_ENV = 'DASHSCOPE_API_KEY';
export const DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE = `$ENV:${DEFAULT_QWEN_PROVIDER_API_KEY_ENV}`;
export const DEFAULT_QWEN_PROVIDER_BASE_URL = QWEN_PROVIDER_BASE_URLS.singapore;
