import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/product-config.generated', () => ({
  productPublicConfig: {
    identity: {
      displayName: 'Example Product',
      cliName: 'example-cli',
      docsUrl: 'https://docs.example.test',
      repositoryUrl: 'https://github.com/example/product',
    },
  },
}));

// The approved copy is pinned here as data, not read back from the catalog under test.
import approved from './__fixtures__/approved-home-copy.json';
import { HomePageContent } from './HomePageContent';
import { architectureLayers, featureCatalog, packageGroups, permissionModes } from './homeCatalog';
import { homeCopy } from './homeCopy';

function escapeHtml(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#x27;');
}

function sectionById(html: string, id: string): string {
  return html.split(`id="${id}"`)[1]?.split('</section>')[0] ?? '';
}

describe('homepage feature coverage', () => {
  for (const locale of ['en', 'ko'] as const) {
    const t = homeCopy[locale];

    it(`presents every feature area with its identifiers and guide in ${locale}`, () => {
      const features = sectionById(renderToStaticMarkup(<HomePageContent locale={locale} />), 'features');

      for (const group of featureCatalog) {
        expect(features).toContain(escapeHtml(t.featureGroups[group.group].title));
        for (const item of group.items) {
          expect(features).toContain(escapeHtml(t.features[item.id].title));
          expect(features).toContain(escapeHtml(t.features[item.id].body));
          expect(features).toContain('guide' in item
            ? `href="https://docs.example.test/en/${item.guide}/"`
            : `href="https://github.com/example/product/blob/main/${item.source}"`);
          for (const tag of item.tags) expect(features).toContain(`<code>${escapeHtml(tag)}</code>`);
        }
      }
    });

    it(`links the hero to each in-page section in ${locale}`, () => {
      const html = renderToStaticMarkup(<HomePageContent locale={locale} />);
      const hero = html.split('</section>')[0];

      for (const id of ['features', 'cli', 'safety', 'architecture', 'install']) {
        expect(hero).toContain(`href="#${id}"`);
        expect(html).toContain(`<section id="${id}"`);
      }
    });

    it(`shows CLI workflows with the configured command name in ${locale}`, () => {
      const cli = sectionById(renderToStaticMarkup(<HomePageContent locale={locale} />), 'cli');

      for (const flow of t.cliFlows) expect(cli).toContain(escapeHtml(flow.title));
      for (const command of ['cat task.md | example-cli -p', 'example-cli --goal "make the failing tests pass"', 'example-cli daemon start', 'example-cli --serve --open', 'PRODUCT_HTTP_TOKEN="$(openssl rand -hex 32)" example-cli --serve --http-port 8787', 'example-cli mcp serve', '/handoff <session-id>', '/remote-control enable', 'example-cli doctor', 'example-cli eval <definition.mjs>']) {
        expect(cli).toContain(`<code>${escapeHtml(command)}</code>`);
      }
      // Alternative commands are examples, not a script: no copy button joins them into one paste.
      expect(cli).not.toContain('<button');
      expect(cli).toContain(escapeHtml(t.sessionLabel));
      expect(cli).toContain(escapeHtml(t.shellLabel));
    });

    it(`tabulates all permission modes in ${locale}`, () => {
      const safety = sectionById(renderToStaticMarkup(<HomePageContent locale={locale} />), 'safety');
      const table = safety.split('<table')[1]?.split('</table>')[0] ?? '';

      for (const mode of permissionModes) {
        expect(table).toContain(`<th scope="row"><code>${mode}</code></th>`);
        for (const value of t.modes[mode]) expect(table).toContain(escapeHtml(value));
      }
      expect(safety).toContain('Bash(git push *)');
    });

    it(`shows the library layers and links every published package in ${locale}`, () => {
      const architecture = sectionById(renderToStaticMarkup(<HomePageContent locale={locale} />), 'architecture');

      for (const layer of architectureLayers) expect(architecture).toContain(escapeHtml(t.layers[layer.id]));
      for (const group of packageGroups) {
        expect(architecture).toContain(escapeHtml(t.packageGroups[group.id].title));
        for (const name of group.packages) {
          expect(architecture).toContain(`href="https://www.npmjs.com/package/@robota-sdk/${name}"`);
        }
      }
    });

    it(`offers npx, global, standalone binary and minimal SDK installs in ${locale}`, () => {
      const install = sectionById(renderToStaticMarkup(<HomePageContent locale={locale} />), 'install');

      expect(install).toContain('npx @robota-sdk/agent-cli');
      expect(install).toContain('npm install -g @robota-sdk/agent-cli');
      expect(install).toContain('curl -fsSL https://raw.githubusercontent.com/example/product/main/scripts/install.sh | bash');
      expect(install).toContain('irm https://raw.githubusercontent.com/example/product/main/scripts/install.ps1 | iex');
      expect(install).toContain('href="https://github.com/example/product/releases"');
      expect(install).toContain('npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic');
    });
  }
});

describe('server rendered homepage content', () => {
  for (const locale of ['en', 'ko'] as const) {
    it(`explains both first tasks and their prerequisites in ${locale}`, () => {
      const html = renderToStaticMarkup(<HomePageContent locale={locale} />);

      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toContain('createQuery');
      expect(html).toContain('@robota-sdk/agent-framework');
      expect(html).toContain('npx @robota-sdk/agent-cli');
      expect(html).toContain('example-cli');
      expect(html).toContain('https://docs.example.test/en/guide/sdk/');
      expect(html).toContain(`https://docs.example.test/${locale}/getting-started/`);
      expect(html).toContain(`href="/${locale}/showcase"`);
      expect(html).toContain(`href="/${locale}/roadmap"`);
      expect(html).toContain('AGPL-3.0');
      expect(html).toContain('MCP');
      expect(html).not.toContain('__PRODUCT_');
    });
  }

  it('puts SDK and CLI actions in the English hero', () => {
    const html = renderToStaticMarkup(<HomePageContent locale="en" />);
    const hero = html.split('</section>')[0];

    expect(hero).toContain('One foundation for agents you use and agents you build.');
    expect(hero).toContain('Build with the SDK');
    expect(hero).toContain('Try the CLI');
    expect(hero).toContain('Our direction: agents that can reliably advance the systems they are built on.');
  });

  it('uses the approved Korean proposition and labels the English SDK guide', () => {
    const html = renderToStaticMarkup(<HomePageContent locale="ko" />);
    const hero = html.split('</section>')[0];

    expect(html).toContain(approved.koTitle);
    expect(hero).toContain(approved.koSdkAction);
    expect(hero).toContain(approved.koHeroVision);
  });

  for (const locale of ['en', 'ko'] as const) {
    it(`shows a normal CLI prompt and the expected first response in ${locale}`, () => {
      const html = renderToStaticMarkup(<HomePageContent locale={locale} />);
      const cliAside = html.split('class="home-cli-aside"')[1]?.split('</section>')[0];

      expect(cliAside).toBeDefined();
      expect(cliAside).toContain('Reply with one sentence.');
      expect(cliAside).toContain(approved.cliExpectedReply[locale]);
    });
  }
});
