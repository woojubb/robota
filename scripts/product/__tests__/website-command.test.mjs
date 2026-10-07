import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { fillProductContent } from '../generate-workspace.mjs';

const websiteRequire = createRequire(new URL('../../../apps/www/package.json', import.meta.url));
const uiTestRequire = createRequire(
  new URL('../../../packages/agent-ui-web/package.json', import.meta.url),
);
const { JSDOM } = uiTestRequire('jsdom');
const React = websiteRequire('react');
const { renderToStaticMarkup } = websiteRequire('react-dom/server');
const source = readFileSync(
  new URL('../../../apps/www/src/app/[locale]/page.tsx', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

function homepage(config, compiled = outputText, exported = 'default', locale = 'en') {
  const module = { exports: {} };
  const require = (name) => {
    if (name === 'next-intl/server')
      return {
        setRequestLocale: () => {},
        getTranslations: async () => Object.assign((key) => key, { raw: () => [] }),
        getMessages: async () => ({}),
      };
    if (name === 'next/font/google')
      return {
        IBM_Plex_Sans: () => ({ variable: 'sans' }),
        IBM_Plex_Mono: () => ({ variable: 'mono' }),
      };
    if (name === 'next-intl')
      return {
        NextIntlClientProvider: ({ children }) => children,
        useLocale: () => locale,
        useTranslations: () => (key) => key,
      };
    if (name === 'next/navigation')
      return { usePathname: () => `/${locale}`, useRouter: () => ({ push: () => {} }) };
    if (name === '@/i18n/routing') return { routing: { locales: ['en', 'ko'] } };
    if (name === '@/components/Header') return { Header: () => null };
    if (name === '@/components/Footer') return { Footer: () => null };
    if (name === '@/components/ui' || name === './ui')
      return {
        InternalLink: ({ children, ...props }) => React.createElement('a', props, children),
      };
    if (name === 'lucide-react') return {};
    if (name === '@/lib/product-config.generated') return { productPublicConfig: config };
    return websiteRequire(name);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports[exported];
}

describe('website installation instructions', () => {
  it.each([
    'Fixture </script><script id="injected">alert(1)</script>',
    'Fixture </SCRIPT><SCRIPT id="injected">alert(1)</SCRIPT>',
  ])(
    'keeps product name %s inside the structured-data script without creating markup',
    async (displayName) => {
      const layout = readFileSync(
        new URL('../../../apps/www/src/app/[locale]/layout.tsx', import.meta.url),
        'utf8',
      );
      const compiled = ts.transpileModule(layout, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      const Layout = homepage({ identity: { displayName, cliName: 'fixture' } }, compiled);
      const html = renderToStaticMarkup(
        await Layout({ params: Promise.resolve({ locale: 'en' }), children: null }),
      );
      const document = new JSDOM(html).window.document;
      const scripts = document.querySelectorAll('script');
      expect(scripts).toHaveLength(1);
      expect(JSON.parse(scripts[0].textContent).name).toBe(displayName);
    },
  );
  it.each([
    ['Cedar Agent', 'cedar'],
    ['Amber Agent', 'amber'],
  ])(
    'launches the installed command independently of the display name %s',
    async (displayName, cliName) => {
      const HomePage = homepage({ identity: { displayName, cliName } });
      const element = await HomePage({ params: Promise.resolve({ locale: 'en' }) });
      const text = new JSDOM(renderToStaticMarkup(element)).window.document.body.textContent;
      expect(text).toContain(`$ ${cliName}`);
      expect(text).toContain('export PRODUCT_CONFIG_FILE=/absolute/path/to/product.env');
      expect(text).not.toContain(`$ ${displayName}`);
    },
  );
});

describe('generated product URL joins', () => {
  const config = {
    identity: {
      displayName: 'Fixture',
      cliName: 'fixture',
      docsUrl: 'https://docs.example.test/',
      websiteUrl: 'https://www.example.test/',
    },
  };
  it.each(['Header', 'Footer'])(
    '%s renders canonical documentation links from normalized root URLs',
    async (component) => {
      const file = `apps/www/src/components/${component}.tsx`;
      const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
      const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      const Component = homepage(config, compiled, component);
      const document = new JSDOM(renderToStaticMarkup(React.createElement(Component))).window
        .document;
      const links = [...document.querySelectorAll('a')]
        .map((a) => a.href)
        .filter((href) => href.startsWith('https://docs.example.test'));
      expect(links.length).toBeGreaterThan(0);
      expect(links).toContain('https://docs.example.test/en/');
      expect(links.every((href) => !new URL(href).pathname.includes('//'))).toBe(true);
    },
  );
  it('renders generated homepage and legacy redirects without duplicated path separators', async () => {
    const file = 'apps/www/src/app/[locale]/page.tsx';
    const filled = fillProductContent(file, source, config);
    const compiled = ts.transpileModule(filled, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const Home = homepage(config, compiled);
    const document = new JSDOM(
      renderToStaticMarkup(await Home({ params: Promise.resolve({ locale: 'ko' }) })),
    ).window.document;
    expect(
      [...document.querySelectorAll('a')].some(
        (a) => a.href === 'https://docs.example.test/ko/getting-started/',
      ),
    ).toBe(true);
    const redirects = fillProductContent(
      'apps/www/public/_redirects',
      readFileSync(new URL('../../../apps/www/public/_redirects', import.meta.url), 'utf8'),
      config,
    );
    expect(redirects).toContain('https://docs.example.test/en/guide/cli/');
    expect(redirects).not.toContain('https://docs.example.test//');
  });
  it.each(['robots', 'sitemap'])(
    '%s emits canonical URLs without duplicated path separators',
    (module) => {
      const source = readFileSync(
        new URL(`../../../apps/www/src/app/${module}.ts`, import.meta.url),
        'utf8',
      );
      const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText;
      const value = homepage(config, compiled)();
      expect(JSON.stringify(value)).not.toContain('https://www.example.test//');
    },
  );
});
