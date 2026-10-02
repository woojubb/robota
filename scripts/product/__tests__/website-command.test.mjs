import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const websiteRequire = createRequire(new URL('../../../apps/www/package.json', import.meta.url));
const uiTestRequire = createRequire(new URL('../../../packages/agent-ui-web/package.json', import.meta.url));
const { JSDOM } = uiTestRequire('jsdom');
const React = websiteRequire('react');
const { renderToStaticMarkup } = websiteRequire('react-dom/server');
const source = readFileSync(new URL('../../../apps/www/src/app/[locale]/page.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

function homepage(config, compiled = outputText) {
  const module = { exports: {} };
  const require = (name) => {
    if (name === 'next-intl/server') return {
      setRequestLocale: () => {},
      getTranslations: async () => Object.assign((key) => key, { raw: () => [] }),
      getMessages: async () => ({}),
    };
    if (name === 'next/font/google') return { IBM_Plex_Sans: () => ({ variable: 'sans' }), IBM_Plex_Mono: () => ({ variable: 'mono' }) };
    if (name === 'next-intl') return { NextIntlClientProvider: ({ children }) => children };
    if (name === '@/components/Header') return { Header: () => null };
    if (name === '@/components/Footer') return { Footer: () => null };
    if (name === '@/components/ui') return {
      InternalLink: ({ children, ...props }) => React.createElement('a', props, children),
    };
    if (name === 'lucide-react') return {};
    if (name === '@/lib/product-config.generated') return { productPublicConfig: config };
    return websiteRequire(name);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports.default;
}

describe('website installation instructions', () => {
  it.each([
    'Fixture </script><script id="injected">alert(1)</script>',
    'Fixture </SCRIPT><SCRIPT id="injected">alert(1)</SCRIPT>',
  ])('keeps product name %s inside the structured-data script without creating markup', async (displayName) => {
    const layout = readFileSync(new URL('../../../apps/www/src/app/[locale]/layout.tsx', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(layout, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const Layout = homepage({ identity: { displayName, cliName: 'fixture' } }, compiled);
    const html = renderToStaticMarkup(await Layout({ params: Promise.resolve({ locale: 'en' }), children: null }));
    const document = new JSDOM(html).window.document;
    const scripts = document.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0].textContent).name).toBe(displayName);
  });
  it.each([
    ['Cedar Agent', 'cedar'],
    ['Amber Agent', 'amber'],
  ])('launches the installed command independently of the display name %s', async (displayName, cliName) => {
    const HomePage = homepage({ identity: { displayName, cliName } });
    const element = await HomePage({ params: Promise.resolve({ locale: 'en' }) });
    const text = new JSDOM(renderToStaticMarkup(element)).window.document.body.textContent;
    expect(text).toContain(`$ ${cliName}`);
    expect(text).toContain('export PRODUCT_CONFIG_FILE=/absolute/path/to/product.env');
    expect(text).not.toContain(`$ ${displayName}`);
  });
});
