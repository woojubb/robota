import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const decode = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/giu, (match, entity) => {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
  const number = entity.toLowerCase().startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
  return number <= 0x10ffff ? String.fromCodePoint(number) : match;
});
const attributes = (text) => Object.fromEntries([...text.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)]
  .map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? '')]));
const tags = (text) => [...text.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/giu)]
  .map((match) => ({ tag: match[1].toLowerCase(), ...attributes(match[2]) }));
const normalized = (value, base) => new URL(value, base).href;
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };

function validateSitemapXml(text) {
  const stack = [];
  let roots = 0;
  const xml = text.replace(/<\?xml\b[^?]*\?>|<!--[\s\S]*?-->/gu, '');
  const tokens = /<\/?([\w:-]+)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gu;
  let cursor = 0;
  for (const match of xml.matchAll(tokens)) {
    const between = xml.slice(cursor, match.index);
    requireCheck(!between.includes('<') && (stack.length || !between.trim()), 'Malformed sitemap XML');
    if (match[0].startsWith('</')) requireCheck(stack.pop() === match[1], 'Unbalanced sitemap XML');
    else {
      if (!stack.length) roots += 1;
      if (!match[0].endsWith('/>')) stack.push(match[1]);
    }
    cursor = match.index + match[0].length;
  }
  requireCheck(roots === 1 && stack.length === 0 && !xml.slice(cursor).trim(), 'Unbalanced sitemap XML');
}

function parseHtml(text, label) {
  const scripts = [];
  const graphs = [];
  const markup = text.replace(/<!--[\s\S]*?-->/gu, '').replace(/<(script|style)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/\1\s*>/giu, (_, tag, attrs, body) => {
    if (tag.toLowerCase() === 'script') {
      const item = attributes(attrs);
      scripts.push(item);
      if (item.type === 'application/ld+json') {
        try { graphs.push(JSON.parse(body)); } catch { throw new Error(`${label}: invalid JSON-LD`); }
      }
    }
    return '';
  });
  const elements = tags(markup);
  const links = elements.filter((item) => item.tag === 'link');
  const metas = elements.filter((item) => item.tag === 'meta');
  return {
    markup, elements, links, metas, scripts,
    nodes: graphs.flatMap((graph) => Array.isArray(graph) ? graph : graph['@graph'] ?? [graph]),
    graphs,
    ids: new Set(elements.flatMap((item) => item.id ? [item.id] : [])),
  };
}

function outputFile(root, pathname, html = false) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+|\/+$/gu, '');
  const target = path.resolve(root, decoded);
  const relative = path.relative(root, target);
  requireCheck(!relative.startsWith('..') && !path.isAbsolute(relative), `Path escapes output: ${pathname}`);
  const choices = html ? (decoded ? [`${target}.html`, path.join(target, 'index.html'), target] : [path.join(root, 'index.html')]) : [target];
  return choices.find((file) => existsSync(file) && statSync(file).isFile());
}

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(file) : entry.name.endsWith('.html') ? [file] : [];
  });
}

/** Check public static output without making any network requests. */
export function verifySearchOutput(directory, { websiteUrl, repositoryUrl } = {}) {
  const root = path.resolve(directory);
  const sitemapFile = path.join(root, 'sitemap.xml');
  requireCheck(existsSync(sitemapFile), 'Missing sitemap.xml');
  const sitemap = readFileSync(sitemapFile, 'utf8');
  validateSitemapXml(sitemap);
  requireCheck(/<urlset\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/u.test(sitemap), 'Invalid sitemap namespace');
  const entries = [...sitemap.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gu)].map((match) => {
    const locations = [...match[1].matchAll(/<loc>([^<]+)<\/loc>/gu)];
    requireCheck(locations.length === 1, 'Every sitemap entry needs exactly one loc');
    return { url: normalized(decode(locations[0][1].trim())), body: match[1] };
  });
  if (!websiteUrl && !entries.length) return { skipped: true, pages: 0, reason: 'Neutral product has no public website configuration.' };
  requireCheck(entries.length > 0 && entries.length <= 50_000, 'Configured site must have a nonempty sitemap within the protocol limit');
  const website = new URL(websiteUrl ?? entries[0].url);
  requireCheck(website.protocol === 'https:', 'Public website must use HTTPS');
  const listed = new Set(entries.map((entry) => entry.url));
  requireCheck(listed.size === entries.length, 'Duplicate sitemap URLs');
  const parsed = new Map();
  const readPage = (file) => {
    if (!parsed.has(file)) parsed.set(file, parseHtml(readFileSync(file, 'utf8'), path.relative(root, file)));
    return parsed.get(file);
  };
  const pages = new Map();
  for (const entry of entries) {
    const url = new URL(entry.url);
    requireCheck(url.origin === website.origin && !url.search && !url.hash, `Noncanonical sitemap URL: ${entry.url}`);
    const file = outputFile(root, url.pathname, true);
    requireCheck(file, `Missing HTML for ${entry.url}`);
    const page = readPage(file);
    const label = entry.url;
    const meta = (name) => page.metas.filter((item) => item.name === name || item.property === name);
    const canonical = page.links.filter((item) => item.rel === 'canonical');
    requireCheck(canonical.length === 1 && normalized(canonical[0].href, label) === label, `${label}: canonical must match sitemap URL`);
    requireCheck(page.elements.filter((item) => item.tag === 'h1').length === 1, `${label}: expected exactly one H1`);
    requireCheck(/<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title>/iu.test(page.markup), `${label}: missing title`);
    requireCheck(meta('description').length === 1 && meta('description')[0].content?.trim(), `${label}: missing unique description tag`);
    for (const name of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      requireCheck(meta(name).length === 1 && meta(name)[0].content?.trim(), `${label}: missing ${name}`);
    }
    requireCheck(normalized(meta('og:url')[0].content, label) === label, `${label}: og:url differs from canonical`);
    requireCheck(!page.metas.some((item) => /^(robots|googlebot|bingbot)$/iu.test(item.name ?? '') && /\b(noindex|none)\b/iu.test(item.content ?? '')), `${label}: accidental noindex`);
    requireCheck(!/__(?:PRODUCT|PROJECT|SERVICE|DEPLOY|PACKAGE|CLI|NPM|ARTIFACT)[A-Z0-9_]*__/u.test(readFileSync(file, 'utf8')), `${label}: unresolved product token`);
    const languages = page.links.filter((item) => item.rel === 'alternate' && item.hreflang);
    const alternatives = Object.fromEntries(languages.map((item) => [item.hreflang, normalized(item.href, label)]));
    requireCheck(languages.length === 3 && ['en', 'ko', 'x-default'].every((lang) => alternatives[lang]), `${label}: incomplete language alternatives`);
    const locale = page.elements.find((item) => item.tag === 'html')?.lang;
    requireCheck(['en', 'ko'].includes(locale) && alternatives[locale] === label && alternatives['x-default'] === alternatives.en, `${label}: wrong self language or default`);
    requireCheck(page.graphs.every((graph) => graph['@context'] === 'https://schema.org'), `${label}: JSON-LD context missing`);
    const hasType = (node, type) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).includes(type);
    const webPages = page.nodes.filter((node) => hasType(node, 'WebPage') && node.url && normalized(node.url, label) === label);
    requireCheck(webPages.length === 1 && webPages[0].inLanguage === locale, `${label}: missing own localized WebPage graph`);
    requireCheck(page.nodes.some((node) => hasType(node, 'WebSite')), `${label}: missing WebSite graph`);
    const sources = page.nodes.filter((node) => hasType(node, 'SoftwareSourceCode'));
    if (repositoryUrl) requireCheck(sources.some((node) => node.codeRepository === repositoryUrl), `${label}: missing configured source repository graph`);
    for (const node of sources) requireCheck(/^https:\/\//u.test(node.codeRepository ?? '') && node.programmingLanguage, `${label}: invalid source graph`);
    if (!['/', '/ko'].includes(url.pathname)) {
      const breadcrumb = page.nodes.find((node) => hasType(node, 'BreadcrumbList'));
      const items = breadcrumb?.itemListElement;
      requireCheck(Array.isArray(items) && items.length >= 2 && items.every((item, index) => item.position === index + 1 && item.name && item.item) && normalized(items.at(-1).item, label) === label, `${label}: missing or invalid breadcrumb`);
    }
    pages.set(label, { page, file, alternatives, entry });
  }
  for (const [label, { page, file, alternatives, entry }] of pages) {
    for (const lang of ['en', 'ko']) {
      const target = pages.get(alternatives[lang]);
      requireCheck(target && ['en', 'ko', 'x-default'].every((key) => target.alternatives[key] === alternatives[key]), `${label}: language alternatives are not reciprocal`);
    }
    const xmlAlternatives = tags(entry.body).filter((item) => item.tag === 'xhtml:link');
    if (xmlAlternatives.length) requireCheck(xmlAlternatives.length === 3 && xmlAlternatives.every((item) => alternatives[item.hreflang] === normalized(item.href, label)), `${label}: sitemap language alternatives disagree with HTML`);
    const references = [
      ...page.elements.filter((item) => ['a', 'area'].includes(item.tag) && item.href).map((item) => ({ value: item.href, html: true })),
      ...page.elements.filter((item) => ['img', 'source'].includes(item.tag) && item.src).map((item) => ({ value: item.src })),
      ...page.scripts.filter((item) => item.src).map((item) => ({ value: item.src })),
      ...page.links.filter((item) => ['stylesheet', 'preload', 'icon', 'modulepreload'].includes(item.rel) && item.href).map((item) => ({ value: item.href })),
      ...page.metas.filter((item) => ['og:image', 'twitter:image'].includes(item.property ?? item.name)).map((item) => ({ value: item.content })),
    ];
    for (const reference of references) {
      const url = new URL(reference.value, label);
      if (url.origin !== website.origin) continue;
      const destination = outputFile(root, url.pathname, reference.html);
      requireCheck(destination, `${label}: missing local ${reference.html ? 'link' : 'asset'} ${reference.value}`);
      if (reference.html && url.hash && destination.endsWith('.html')) requireCheck(readPage(destination).ids.has(decodeURIComponent(url.hash.slice(1))), `${label}: broken fragment ${reference.value}`);
    }
    requireCheck(file, `Missing page ${label}`);
  }
  // Catch a newly exported canonical page accidentally omitted from the sitemap.
  for (const file of htmlFiles(root)) {
    if (path.basename(file) === '404.html') continue;
    const page = readPage(file);
    const canonical = page.links.find((item) => item.rel === 'canonical');
    if (!canonical) continue;
    const url = new URL(canonical.href, website);
    if (url.origin === website.origin && outputFile(root, url.pathname, true) === file) requireCheck(listed.has(url.href), `Canonical page missing from sitemap: ${url.href}`);
  }
  const robots = readFileSync(path.join(root, 'robots.txt'), 'utf8');
  requireCheck(/^User-agent:\s*\*\s*$/imu.test(robots) && /^Allow:\s*\/\s*$/imu.test(robots), 'robots.txt must allow public content');
  requireCheck(!/^Disallow:\s*\/\s*$/imu.test(robots), 'robots.txt blocks public crawlers');
  const sitemapUrls = [...robots.matchAll(/^Sitemap:\s*(\S+)/gimu)].map((match) => normalized(match[1], website));
  requireCheck(sitemapUrls.includes(new URL('/sitemap.xml', website).href), 'robots.txt must reference the canonical sitemap');
  const llms = readFileSync(path.join(root, 'llms.txt'), 'utf8');
  requireCheck(/^#\s+\S/mu.test(llms) && !/__(?:PRODUCT|PROJECT|SERVICE)[A-Z0-9_]*__/u.test(llms), 'llms.txt is missing its heading or contains unresolved tokens');
  const llmsLinks = [...llms.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/gu)].map((match) => new URL(decode(match[1])));
  requireCheck(llmsLinks.some((url) => listed.has(url.href)), 'llms.txt needs canonical marketing links');
  for (const url of llmsLinks) if (url.origin === website.origin) requireCheck(listed.has(url.href) || outputFile(root, url.pathname), `llms.txt has a noncanonical or missing local link: ${url.href}`);
  return { skipped: false, pages: pages.size };
}

function selectedIdentity() {
  const source = readFileSync(path.join(appRoot, 'src/lib/product-config.generated.ts'), 'utf8');
  const readString = (name) => {
    const match = source.match(new RegExp(`(?:"${name}"|\\b${name})\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, 'u'));
    return match ? JSON.parse(match[1]) : undefined;
  };
  return { websiteUrl: readString('websiteUrl'), repositoryUrl: readString('repositoryUrl') };
}

/** Small complete exports prove that malformed search output fails the build. */
async function selfTest() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'search-output-check-'));
  const websiteUrl = 'https://fixture.test/';
  const repositoryUrl = 'https://github.com/example/fixture';
  const urls = ['/', '/ko', '/en/guide', '/ko/guide'];
  const html = (pathname) => {
    const locale = pathname.startsWith('/ko') ? 'ko' : 'en';
    const child = pathname.endsWith('/guide');
    const en = child ? '/en/guide' : '/';
    const ko = child ? '/ko/guide' : '/ko';
    const url = new URL(pathname, websiteUrl).href;
    const nodes = [
      { '@type': 'WebSite', url: websiteUrl },
      { '@type': 'WebPage', url, inLanguage: locale },
      { '@type': 'SoftwareSourceCode', codeRepository: repositoryUrl, programmingLanguage: 'TypeScript' },
      ...(child ? [{ '@type': 'BreadcrumbList', itemListElement: [{ position: 1, name: 'Home', item: websiteUrl }, { position: 2, name: 'Guide', item: url }] }] : []),
    ];
    return `<html lang="${locale}"><head><title>Fixture &amp; guide</title><link rel="canonical" href="${url}"><meta name="description" content="Fixture description">
      ${Object.entries({ en, ko, 'x-default': en }).map(([lang, route]) => `<link rel="alternate" hreflang="${lang}" href="${new URL(route, websiteUrl).href}">`).join('')}
      ${['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'].map((name) => `<meta ${name.startsWith('og:') ? 'property' : 'name'}="${name}" content="${name.endsWith('image') ? `${websiteUrl}image.svg` : name === 'og:url' ? url : 'Fixture'}">`).join('')}
      <link rel="stylesheet" href="/style.css"><script src="/_next/static/chunks/app/%5Blocale%5D/part.js"></script>
      <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })}</script></head>
      <body><h1>Fixture</h1><p id="setup&amp;usage">Ready</p><a href="#setup%26usage">Setup</a><a href="/ko?source=test&amp;mode=read">Korean</a></body></html>`;
  };
  const files = new Map(urls.map((url) => [url === '/' ? 'index.html' : `${url.slice(1)}.html`, html(url)]));
  files.set('sitemap.xml', `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${new URL(url, websiteUrl).href}</loc></url>`).join('')}</urlset>`);
  files.set('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${websiteUrl}sitemap.xml\n`);
  files.set('llms.txt', `# Fixture\n[Home](${websiteUrl})\n[Guide](${websiteUrl}en/guide)\n`);
  files.set('style.css', 'body{font-size:16px}');
  files.set('image.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  files.set('_next/static/chunks/app/[locale]/part.js', 'void 0;');
  const restore = async () => {
    for (const [name, text] of files) {
      const file = path.join(temporary, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
  };
  try {
    await restore();
    assert.equal(verifySearchOutput(temporary, { websiteUrl, repositoryUrl }).pages, 4);
    const cases = [
      ['index.html', (text) => text.replace('rel="canonical"', 'rel="unrelated"'), /canonical/],
      ['index.html', (text) => text.replace('<h1>Fixture</h1>', '<h1>One</h1><h1>Two</h1>'), /one H1/],
      ['index.html', (text) => text.replace('name="description"', 'name="unused"'), /description/],
      ['index.html', (text) => text.replace('<head>', '<head><meta name="robots" content="noindex">'), /noindex/],
      ['index.html', (text) => text.replace('hreflang="ko" href="https://fixture.test/ko"', 'hreflang="ko" href="https://fixture.test/ko/guide"'), /reciprocal/],
      ['index.html', (text) => text.replace('"@type":"WebPage"', '"@type":"Thing"'), /WebPage/],
      ['index.html', (text) => text.replace(repositoryUrl, 'https://github.com/example/wrong'), /repository/],
      ['en/guide.html', (text) => text.replace('"@type":"BreadcrumbList"', '"@type":"Thing"'), /breadcrumb/],
      ['index.html', (text) => text.replace('app/%5Blocale%5D/part.js', 'app/%5Blocale%5D/missing.js'), /missing local asset/],
      ['index.html', (text) => text.replace('#setup%26usage', '#unknown'), /broken fragment/],
      ['index.html', (text) => text.replace('>Ready<', `>${'__' + 'PRODUCT_DISPLAY_NAME__'}<`), /unresolved/],
      ['robots.txt', (text) => text.replace('Allow: /', 'Disallow: /'), /robots/],
      ['llms.txt', (text) => `${text}[Missing](${websiteUrl}missing)\n`, /missing local link/],
      ['sitemap.xml', (text) => text.replace('<url><loc>https://fixture.test/ko/guide</loc></url>', ''), /reciprocal|missing from sitemap/],
      ['sitemap.xml', (text) => `${text}</urlset>`, /sitemap XML/],
    ];
    for (const [name, change, error] of cases) {
      await restore();
      await writeFile(path.join(temporary, name), change(files.get(name)));
      assert.throws(() => verifySearchOutput(temporary, { websiteUrl, repositoryUrl }), error, name);
    }
    await restore();
    await writeFile(path.join(temporary, 'sitemap.xml'), '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    assert.equal(verifySearchOutput(temporary).skipped, true);
    assert.throws(() => verifySearchOutput(temporary, { websiteUrl }), /nonempty sitemap/);
    process.stdout.write(`Search output verifier self-test passed: valid encoded assets/entities, ${cases.length} malformed exports, neutral/configured distinction.\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--self-test')) {
      await selfTest();
      process.exit(0);
    }
    const result = verifySearchOutput(path.join(appRoot, 'out'), selectedIdentity());
    process.stdout.write(result.skipped ? `Search output verification skipped: ${result.reason}\n` : `Search output verified: ${result.pages} canonical pages, reciprocal languages, structured data, links, robots and llms.txt.\n`);
  } catch (error) {
    process.stderr.write(`Search output verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
