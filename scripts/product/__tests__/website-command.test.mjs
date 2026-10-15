import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { fillProductContent } from '../generate-workspace.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const websiteRequire = createRequire(new URL('../../../apps/www/package.json', import.meta.url));
const uiTestRequire = createRequire(new URL('../../../packages/agent-ui-web/package.json', import.meta.url));
const { JSDOM } = uiTestRequire('jsdom');
const React = websiteRequire('react');
const { renderToStaticMarkup } = websiteRequire('react-dom/server');
const { createTranslator } = websiteRequire('next-intl');

function websiteModule(file, config, locale = 'en') {
  const cache = new Map();
  const load = (filePath) => {
    let resolved = filePath;
    if (!existsSync(resolved)) {
      resolved = ['.tsx', '.ts', '.json'].map((extension) => filePath + extension).find(existsSync);
    }
    if (!resolved) throw new Error(`Missing website fixture module: ${filePath}`);
    if (resolved.endsWith('product-config.generated.ts')) return { productPublicConfig: config };
    if (resolved.endsWith('.css')) return {};
    if (cache.has(resolved)) return cache.get(resolved);
    const source = fillProductContent(path.relative(root, resolved), readFileSync(resolved, 'utf8'), config);
    if (resolved.endsWith('.json')) return JSON.parse(source);
    const module = { exports: {} };
    cache.set(resolved, module.exports);
    const messages = () => load(path.join(root, `apps/www/src/messages/${locale}.json`));
    const translate = (namespace) => createTranslator({ locale, messages: messages(), namespace });
    const require = (name) => {
      if (name === 'next-intl/server') return {
        setRequestLocale: () => {},
        getTranslations: async (input) => translate(typeof input === 'string' ? input : input?.namespace),
      };
      if (name === 'next/font/google') return {
        IBM_Plex_Sans: () => ({ variable: 'sans' }), IBM_Plex_Mono: () => ({ variable: 'mono' }),
      };
      if (name === 'next-intl') return {
        NextIntlClientProvider: ({ children }) => children,
        useLocale: () => locale, useTranslations: translate,
      };
      if (name === 'next/navigation') return {
        usePathname: () => locale === 'en' ? '/' : `/${locale}`,
        useRouter: () => ({ push: () => {} }),
        notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
      };
      if (name === 'next/link') return {
        __esModule: true,
        default: ({ children, prefetch: _prefetch, ...props }) => React.createElement('a', props, children),
      };
      if (name.startsWith('@/')) return load(path.join(root, 'apps/www/src', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(resolved), name));
      return websiteRequire(name);
    };
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
  };
  return load(path.join(root, file));
}

async function homepage(config, locale = 'en') {
  const page = locale === 'en' ? 'apps/www/src/app/(home)/page.tsx' : 'apps/www/src/app/[locale]/page.tsx';
  return websiteModule(page, config, locale).default({ params: Promise.resolve({ locale }) });
}

describe('website installation instructions', () => {
  it.each([
    'Fixture </script><script id="injected">alert(1)</script>',
    'Fixture </SCRIPT><SCRIPT id="injected">alert(1)</SCRIPT>',
  ])('keeps product name %s inside the structured-data graph without creating markup', async (displayName) => {
    const config = { identity: { displayName, cliName: 'fixture', websiteUrl: 'https://example.test' } };
    const document = new JSDOM(renderToStaticMarkup(await homepage(config))).window.document;
    const scripts = document.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    const graph = JSON.parse(scripts[0].textContent)['@graph'];
    expect(graph.find((node) => node['@type'] === 'SoftwareApplication').name).toBe(displayName);
    expect(graph.find((node) => node['@type'] === 'WebSite').name).toBe(displayName);
  });
  it.each([['Cedar Agent', 'cedar'], ['Amber Agent', 'amber']])(
    'shows the public package command independently of the display name %s', async (displayName, cliName) => {
      const document = new JSDOM(renderToStaticMarkup(await homepage({ identity: { displayName, cliName } }))).window.document;
      const code = [...document.querySelectorAll('code')].map((element) => element.textContent).join('\n');
      expect(code).toContain('npx @robota-sdk/agent-cli');
      expect(code).not.toContain('PRODUCT_CONFIG_FILE');
      expect(code).not.toContain(`npx ${displayName}`);
      expect(document.body.textContent).toContain(cliName);
    },
  );
});

describe('generated product URL joins', () => {
  const config = { identity: {
    displayName: 'Fixture', cliName: 'fixture', docsUrl: 'https://docs.example.test/', websiteUrl: 'https://www.example.test/',
  } };
  it.each(['Header', 'Footer'])('%s renders documentation links from normalized root URLs', (component) => {
    const Component = websiteModule(`apps/www/src/components/${component}.tsx`, config)[component];
    const document = new JSDOM(renderToStaticMarkup(React.createElement(Component))).window.document;
    const links = [...document.querySelectorAll('a')].map((a) => a.href).filter((href) => href.startsWith('https://docs.example.test'));
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((href) => !new URL(href).pathname.includes('//'))).toBe(true);
  });
  it('renders Korean homepage links and legacy redirects without duplicated separators', async () => {
    const document = new JSDOM(renderToStaticMarkup(await homepage(config, 'ko'))).window.document;
    const links = [...document.querySelectorAll('a')].map((a) => a.href);
    expect(links).toContain('https://docs.example.test/ko/getting-started/');
    expect(links).toContain('https://docs.example.test/en/guide/sdk/');
    const redirects = fillProductContent('apps/www/public/_redirects', readFileSync(path.join(root, 'apps/www/public/_redirects'), 'utf8'), config);
    expect(redirects).toContain('https://docs.example.test/en/guide/cli/');
    expect(redirects).not.toContain('https://docs.example.test//');
  });
  it.each(['robots', 'sitemap'])('%s emits canonical URLs without duplicated separators', (name) => {
    const value = websiteModule(`apps/www/src/app/${name}.ts`, config).default();
    expect(JSON.stringify(value)).not.toContain('https://www.example.test//');
  });
});
