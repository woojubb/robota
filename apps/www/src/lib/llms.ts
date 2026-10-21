import { productPublicConfig } from './product-config.generated';
import { marketingCopy, marketingPages, marketingPath } from './marketing';

/** A discovery index, generated from the same selected product and canonical page catalog. */
export function getLlmsIndex(): string {
  const { displayName, websiteUrl, repositoryUrl, docsUrl } = productPublicConfig.identity;
  if (!websiteUrl) return '';
  const lines = [
    `# ${displayName}`,
    '',
    `> ${marketingCopy('en', 'home').description}`,
    '',
    'The SDK embeds agents in a Node.js application. The coding CLI is a first-party interface built with the public SDK packages.',
    'Node.js 22.12 or later, a configured provider endpoint, and a suitable model are required. Hosted providers may charge separately.',
    'Packages are in public beta; APIs may change. Conversation persistence requires a session store. Tool access depends on workspace trust, permission settings, and the host.',
    '',
  ];
  for (const locale of ['en', 'ko'] as const) {
    lines.push(`## ${locale === 'en' ? 'English' : 'Korean'} pages`, '');
    for (const page of marketingPages) {
      const { title, description } = marketingCopy(locale, page);
      lines.push(`- [${title}](${new URL(marketingPath(locale, page), websiteUrl)}): ${description}`);
    }
    lines.push('');
  }
  lines.push('## Primary sources', '');
  if (docsUrl) {
    const docs = docsUrl.replace(/\/+$/u, '');
    lines.push(
      `- [SDK guide](${docs}/en/guide/sdk/): Public APIs and a first query.`,
      `- [CLI setup](${docs}/en/getting-started/): Installation and provider configuration.`,
      `- [Korean CLI setup](${docs}/ko/getting-started/): Korean setup guide.`,
      `- [Documentation index for language models](${docs}/llms.txt): Detailed documentation links.`,
      `- [Full documentation text](${docs}/llms-full.txt): Documentation in one text file.`,
    );
  }
  if (repositoryUrl) {
    const repo = repositoryUrl.replace(/\/+$/u, '');
    lines.push(
      `- [Source repository](${repo}): Implementation, issues, and release history.`,
      `- [Licensing](${repo}/blob/main/LICENSING.md): AGPL-3.0-only and commercial licensing options.`,
    );
  }
  lines.push('', 'Plans on the roadmap are not promised capabilities. Consult the linked documentation and source for current behavior.', '');
  return lines.join('\n');
}
