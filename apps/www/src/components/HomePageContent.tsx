import { productPublicConfig } from '@/lib/product-config.generated';
import { marketingPath, type MarketingLocale } from '@/lib/marketing';
import { CodeBlock } from './CodeBlock';
import { architectureLayers, featureCatalog, packageGroups, packageScope, permissionModes } from './homeCatalog';
import { homeCopy } from './homeCopy';

const sdkInstall = 'npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-openai';
const sdkMinimalInstall = 'npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic';
const sdkExample = `import { createQuery } from '@robota-sdk/agent-framework';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const model = 'your-loaded-model-id';
const query = createQuery({
  provider: new OpenAIProvider({
    apiKey: 'local',
    baseURL: 'http://127.0.0.1:1234/v1',
  }),
  model,
});

try {
  console.log(await query('Reply with one sentence.'));
} finally {
  await query.shutdown();
}`;
const permissionRules = `{
  "permissions": {
    "allow": ["Bash(pnpm *)", "Bash(git status)"],
    "ask": ["Bash(git push *)"],
    "deny": ["Bash(rm -rf *)", "Write(.env)"]
  }
}`;

function cliFlowCommands(cli: string): readonly string[] {
  return [
    `${cli}\n${cli} --permission-mode acceptEdits\n${cli} --screen-reader`,
    `${cli} -p "List the TypeScript files in src/"\n${cli} -p "Summarize this repository" --output-format json\ncat task.md | ${cli} -p\n${cli} --goal "make the failing tests pass"`,
    `${cli} -c\n${cli} -r <id-or-name>\n${cli} session start --background --name nightly\n${cli} daemon start\n${cli} --attach`,
    `${cli} --serve --open\n${cli} --serve --http-port 8787\n${cli} mcp serve`,
    '/peers\n/peers send <session-id> <message>\n/handoff <session-id>\n/devices init\n/remote-control enable',
    `${cli} doctor\n${cli} usage --period 30d\n${cli} --check-update\n${cli} eval <definition.mjs>`,
  ];
}

/** Raw installer URL for a GitHub repository; other hosts have no known raw-file layout. */
function installerUrl(repoUrl: string | undefined, file: string): string | undefined {
  const match = repoUrl?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u);
  return match ? `https://raw.githubusercontent.com/${match[1]}/main/scripts/${file}` : undefined;
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export function HomePageContent({ locale }: { locale: MarketingLocale }) {
  const t = homeCopy[locale];
  const identity = productPublicConfig.identity;
  const cli = identity.cliName || 'robota';
  const docsUrl = identity.docsUrl?.replace(/\/+$/u, '');
  const repoUrl = identity.repositoryUrl?.replace(/\/+$/u, '');
  const guideUrl = (path: string) => (docsUrl ? `${docsUrl}/en/${path}/` : undefined);
  const sdkGuideUrl = guideUrl('guide/sdk') ?? 'https://www.npmjs.com/package/@robota-sdk/agent-framework';
  const cliGuideUrl = docsUrl
    ? `${docsUrl}/${locale}/getting-started/`
    : 'https://www.npmjs.com/package/@robota-sdk/agent-cli';
  const cliCode = 'npx @robota-sdk/agent-cli';
  const unixInstaller = installerUrl(repoUrl, 'install.sh');
  const windowsInstaller = installerUrl(repoUrl, 'install.ps1');
  const codeLabels = { copyLabel: t.copy, copiedLabel: t.copied, failureLabel: t.copyFailed };
  const cliFlows = cliFlowCommands(cli);
  const jumpTargets = ['features', 'cli', 'safety', 'architecture', 'install'] as const;

  return (
    <div className="homepage">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-container home-hero-inner">
          <div className="home-eyebrow"><span className="home-status-dot" />{t.beta}<span className="home-eyebrow-divider" />{t.eyebrow}</div>
          <h1 id="home-title">{t.title}</h1>
          <p className="home-hero-lead">{t.lead}</p>
          <div className="home-actions">
            <a className="home-button home-button-primary" href={sdkGuideUrl}>{t.sdkAction}<Arrow /></a>
            <a className="home-button home-button-secondary" href={cliGuideUrl}>{t.cliAction}<Arrow /></a>
          </div>
          <p className="home-hero-note">{t.heroNote}</p>
          <p className="home-hero-vision">{t.heroVision}</p>
          <nav className="home-jump" aria-label={t.jumpLabel}>
            {jumpTargets.map((target) => <a key={target} href={`#${target}`}>{t.jumpLinks[target]}</a>)}
          </nav>
          <div className="home-hero-mark" aria-hidden="true"><span>01 / SDK</span><span>→</span><span>02 / CLI</span></div>
        </div>
      </section>

      <section className="home-section home-proof" aria-labelledby="proof-title">
        <div className="home-container">
          <div className="home-section-heading">
            <p className="home-kicker">01 / {t.proofEyebrow}</p>
            <h2 id="proof-title">{t.proofTitle}</h2>
            <p>{t.proofLead}</p>
          </div>
          <figure className="home-foundation">
            <div className="home-foundation-base"><span>@robota-sdk/agent-framework</span><strong>{t.sdkLabel}</strong><small>sessions · tools · permissions</small></div>
            <div className="home-foundation-arrow" aria-hidden="true">↓</div>
            <div className="home-foundation-cli"><span>@robota-sdk/agent-cli</span><strong>{t.cliLabel}</strong><small>{identity.cliName}</small></div>
            <figcaption>{t.diagramCaption}</figcaption>
          </figure>
          <div className="home-code-grid">
            <div>
              <CodeBlock code={sdkInstall} label={t.installLabel} {...codeLabels} />
              <CodeBlock code={sdkExample} label={t.exampleLabel} {...codeLabels} />
              <p className="home-code-note">{t.exampleNote}</p>
              {repoUrl && <a className="home-text-link" href={`${repoUrl}/blob/main/packages/agent-framework/README.md`}>{t.codeSource} <Arrow /></a>}
            </div>
            <div className="home-cli-aside">
              <p className="home-aside-label">02 / {t.cliLabel}</p>
              <CodeBlock code={cliCode} label={t.cliCodeLabel} {...codeLabels} />
              <p>{t.tasks[1].needs}</p>
              <p>{t.cliPromptIntro}</p>
              <p className="home-cli-prompt"><code>Reply with one sentence.</code></p>
              <p>{t.cliExpectedReply}</p>
              <a className="home-text-link" href={cliGuideUrl}>{t.tasks[1].action} <Arrow /></a>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-tasks" aria-labelledby="tasks-title">
        <div className="home-container">
          <div className="home-section-heading"><p className="home-kicker">02 / {t.tasksEyebrow}</p><h2 id="tasks-title">{t.tasksTitle}</h2></div>
          <div className="home-task-grid">
            {t.tasks.map((task, index) => <article className="home-task-card" key={task.title}>
              <span className="home-card-index">0{index + 1}</span>
              <h3>{task.title}</h3>
              <p>{task.body}</p>
              <div className="home-prereq"><strong>{t.prereqLabel}</strong><p>{task.needs}</p></div>
              <a className="home-text-link" href={index === 0 ? sdkGuideUrl : cliGuideUrl}>{task.action} <Arrow /></a>
            </article>)}
          </div>
        </div>
      </section>

      <section id="features" className="home-section home-capabilities" aria-labelledby="features-title">
        <div className="home-container">
          <div className="home-section-heading"><p className="home-kicker">03 / {t.featuresEyebrow}</p><h2 id="features-title">{t.featuresTitle}</h2><p>{t.featuresLead}</p></div>
          {featureCatalog.map((group) => <div className="home-feature-group" key={group.group}>
            <div className="home-feature-group-heading"><h3>{t.featureGroups[group.group].title}</h3><p>{t.featureGroups[group.group].body}</p></div>
            <div className="home-capability-grid">
              {group.items.map((item) => {
                const href = guideUrl(item.guide);
                return <article className="home-capability" key={item.id}>
                  <h4>{t.features[item.id].title}</h4>
                  <p>{t.features[item.id].body}</p>
                  <ul className="home-tags">{item.tags.map((tag) => <li key={tag}><code>{tag}</code></li>)}</ul>
                  {href && <a className="home-text-link" href={href}>{t.guideLink} <Arrow /></a>}
                </article>;
              })}
            </div>
          </div>)}
        </div>
      </section>

      <section id="cli" className="home-section" aria-labelledby="cli-title">
        <div className="home-container">
          <div className="home-section-heading"><p className="home-kicker">04 / {t.cliEyebrow}</p><h2 id="cli-title">{t.cliTitle}</h2><p>{t.cliLead}</p></div>
          <div className="home-flow-grid">
            {t.cliFlows.map((flow, index) => <article className="home-flow" key={flow.title}>
              <span className="home-card-index">0{index + 1}</span>
              <h3>{flow.title}</h3>
              <p>{flow.body}</p>
              <CodeBlock code={cliFlows[index] ?? ''} label={flow.title} {...codeLabels} />
            </article>)}
          </div>
          {docsUrl && <a className="home-text-link" href={guideUrl('guide/cli')}>{t.cliGuideLink} <Arrow /></a>}
        </div>
      </section>

      <section id="safety" className="home-section home-proof" aria-labelledby="safety-title">
        <div className="home-container">
          <div className="home-section-heading"><p className="home-kicker">05 / {t.safetyEyebrow}</p><h2 id="safety-title">{t.safetyTitle}</h2><p>{t.safetyLead}</p></div>
          <div className="home-safety-grid">
            <div className="home-table-wrap" tabIndex={0} role="region" aria-label={t.modeTableCaption}>
              <table className="home-table">
                <caption>{t.modeTableCaption}</caption>
                <thead><tr>{t.modeHeaders.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
                <tbody>
                  {permissionModes.map((mode) => <tr key={mode}>
                    <th scope="row"><code>{mode}</code></th>
                    {t.modes[mode].map((value, index) => <td key={index}>{value}</td>)}
                  </tr>)}
                </tbody>
              </table>
            </div>
            <div>
              <CodeBlock code={permissionRules} label={t.rulesLabel} {...codeLabels} />
              <div className="home-fit-list">{t.safetyNotes.map((note) => <article key={note.title}><h3>{note.title}</h3><p>{note.body}</p></article>)}</div>
              {docsUrl && <a className="home-text-link" href={guideUrl('guide/permissions-and-hooks')}>{t.safetyLink} <Arrow /></a>}
            </div>
          </div>
        </div>
      </section>

      <section id="architecture" className="home-section" aria-labelledby="architecture-title">
        <div className="home-container">
          <div className="home-section-heading"><p className="home-kicker">06 / {t.architectureEyebrow}</p><h2 id="architecture-title">{t.architectureTitle}</h2><p>{t.architectureLead}</p></div>
          <ol className="home-layers">
            {architectureLayers.map((layer) => <li key={layer.id}>
              <ul className="home-tags">{layer.packages.map((name) => <li key={name}><code>{name}</code></li>)}</ul>
              <span>{t.layers[layer.id]}</span>
            </li>)}
          </ol>
          {docsUrl && <a className="home-text-link" href={guideUrl('guide/architecture')}>{t.architectureLink} <Arrow /></a>}
          <div className="home-feature-group">
            <div className="home-feature-group-heading"><h3>{t.packagesTitle}</h3><p>{t.packagesLead}</p></div>
            <div className="home-package-grid">
              {packageGroups.map((group) => <article className="home-package-group" key={group.id}>
                <h4>{t.packageGroups[group.id].title}</h4>
                <p>{t.packageGroups[group.id].body}</p>
                <ul className="home-package-list">
                  {group.packages.map((name) => <li key={name}><a href={`https://www.npmjs.com/package/${packageScope}${name}`}>{packageScope}{name}</a></li>)}
                </ul>
              </article>)}
            </div>
            {docsUrl && <a className="home-text-link" href={guideUrl('packages')}>{t.packagesLink} <Arrow /></a>}
          </div>
        </div>
      </section>

      <section id="install" className="home-section home-proof" aria-labelledby="install-title">
        <div className="home-container">
          <div className="home-section-heading"><p className="home-kicker">07 / {t.installEyebrow}</p><h2 id="install-title">{t.installTitle}</h2><p>{t.installLead}</p></div>
          <div className="home-flow-grid">
            <article className="home-flow">
              <h3>{t.installOptions.npx.title}</h3><p>{t.installOptions.npx.body}</p>
              <CodeBlock code={cliCode} label={t.installOptions.npx.title} {...codeLabels} />
            </article>
            <article className="home-flow">
              <h3>{t.installOptions.global.title}</h3><p>{t.installOptions.global.body}</p>
              <CodeBlock code={`npm install -g @robota-sdk/agent-cli\n${cli}`} label={t.installOptions.global.title} {...codeLabels} />
            </article>
            {unixInstaller && windowsInstaller && <article className="home-flow">
              <h3>{t.installOptions.binary.title}</h3><p>{t.installOptions.binary.body}</p>
              <CodeBlock code={`curl -fsSL ${unixInstaller} | bash`} label={t.binaryUnix} {...codeLabels} />
              <CodeBlock code={`irm ${windowsInstaller} | iex`} label={t.binaryWindows} {...codeLabels} />
              <a className="home-text-link" href={`${repoUrl}/releases`}>{t.releasesLink} <Arrow /></a>
            </article>}
            <article className="home-flow">
              <h3>{t.installOptions.sdk.title}</h3><p>{t.installOptions.sdk.body}</p>
              <CodeBlock code={sdkMinimalInstall} label={t.installOptions.sdk.title} {...codeLabels} />
            </article>
          </div>
        </div>
      </section>

      <section className="home-section home-fit" aria-labelledby="fit-title">
        <div className="home-container home-fit-grid">
          <div className="home-section-heading"><p className="home-kicker">08 / {t.fitEyebrow}</p><h2 id="fit-title">{t.fitTitle}</h2><p>{t.fitLead}</p><a className="home-text-link" href={marketingPath(locale, 'showcase')}>{t.fitLink} <Arrow /></a></div>
          <div className="home-fit-list">{t.fitItems.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
        </div>
      </section>

      <section className="home-section home-vision" aria-labelledby="vision-title">
        <div className="home-container"><p className="home-kicker">09 / {t.visionEyebrow}</p><h2 id="vision-title">{t.visionTitle}</h2><p>{t.visionBody}</p><div className="home-vision-footer"><span>{t.roadmapNote}</span><a className="home-text-link" href={marketingPath(locale, 'roadmap')}>{t.roadmapLink} <Arrow /></a></div></div>
      </section>

      <section className="home-section home-faq" aria-labelledby="faq-title">
        <div className="home-container home-faq-grid"><div className="home-section-heading"><p className="home-kicker">10 / {t.faqEyebrow}</p><h2 id="faq-title">{t.faqTitle}</h2></div><div className="home-faq-list">{t.faqs.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></div>
      </section>

      <section className="home-final" aria-labelledby="close-title"><div className="home-container"><h2 id="close-title">{t.closeTitle}</h2><p>{t.closeBody}</p><div className="home-actions"><a className="home-button home-button-primary" href={sdkGuideUrl}>{t.sdkGuide}<Arrow /></a><a className="home-button home-button-secondary" href={cliGuideUrl}>{t.tasks[1].action}<Arrow /></a></div></div></section>
    </div>
  );
}
