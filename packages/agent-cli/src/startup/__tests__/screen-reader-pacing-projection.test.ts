import { describe, expect, it } from 'vitest';

import { resolveProductScreenReaderPacing } from '../screen-reader-pacing-projection.js';

describe('test-product Agent screen-reader pacing projection', () => {
  it('passes raw CLI overrides with their exact diagnostic names', () => {
    expect(resolveProductScreenReaderPacing({
      PRODUCT_SCREEN_READER_STARTUP_QUIET_MS: '0',
      PRODUCT_SCREEN_READER_PREPARK_MS: 'soon',
    })).toEqual({
      startupQuiet: {
        raw: '0',
        label: 'PRODUCT_SCREEN_READER_STARTUP_QUIET_MS',
      },
      prepark: {
        raw: 'soon',
        label: 'PRODUCT_SCREEN_READER_PREPARK_MS',
      },
    });
  });
});
