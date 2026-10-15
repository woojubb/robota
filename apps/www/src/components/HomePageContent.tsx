import { productPublicConfig } from '@/lib/product-config.generated';
import { marketingPath, type MarketingLocale } from '@/lib/marketing';
import { CodeBlock } from './CodeBlock';

type Copy = {
  beta: string;
  eyebrow: string;
  title: string;
  lead: string;
  sdkAction: string;
  cliAction: string;
  heroNote: string;
  heroVision: string;
  proofEyebrow: string;
  proofTitle: string;
  proofLead: string;
  sdkLabel: string;
  cliLabel: string;
  diagramCaption: string;
  installLabel: string;
  exampleLabel: string;
  cliCodeLabel: string;
  cliPromptIntro: string;
  cliExpectedReply: string;
  copy: string;
  copied: string;
  copyFailed: string;
  exampleNote: string;
  codeSource: string;
  tasksEyebrow: string;
  tasksTitle: string;
  tasks: readonly {
    title: string;
    body: string;
    needs: string;
    action: string;
  }[];
  capabilitiesEyebrow: string;
  capabilitiesTitle: string;
  capabilities: readonly { title: string; body: string; link: string; href: string }[];
  fitEyebrow: string;
  fitTitle: string;
  fitLead: string;
  fitItems: readonly { title: string; body: string }[];
  fitLink: string;
  visionEyebrow: string;
  visionTitle: string;
  visionBody: string;
  roadmapNote: string;
  roadmapLink: string;
  faqEyebrow: string;
  faqTitle: string;
  faqs: readonly { question: string; answer: string }[];
  closeTitle: string;
  closeBody: string;
  sdkGuide: string;
};

const copy: Record<MarketingLocale, Copy> = {
  en: {
    beta: 'Public beta',
    eyebrow: 'TypeScript agent SDK + coding CLI',
    title: 'One foundation for agents you use and agents you build.',
    lead: 'Build an agent into your TypeScript application with the SDK. Or work in your terminal with the coding CLI built from the same public components. Configure a model endpoint, tools, permissions, and sessions for the task at hand.',
    sdkAction: 'Build with the SDK',
    cliAction: 'Try the CLI',
    heroNote: 'Public packages · Node.js 22.12 or later · Bring a model endpoint',
    heroVision: 'Our direction: agents that can reliably advance the systems they are built on.',
    proofEyebrow: 'The shared foundation',
    proofTitle: 'Inspect the pieces. Then run a first query.',
    proofLead: 'The agent framework assembles sessions, tools, and permission checks. The coding CLI is one maintained interface built on it. You can use the framework from your own Node.js application.',
    sdkLabel: 'Agent framework',
    cliLabel: 'Coding CLI',
    diagramCaption: 'One public TypeScript foundation, with an embeddable path and a ready terminal interface.',
    installLabel: 'Install the SDK packages',
    exampleLabel: 'One-shot TypeScript query',
    cliCodeLabel: 'CLI setup outline',
    cliPromptIntro: 'After configuring a provider and model, type a normal prompt:',
    cliExpectedReply: 'Look for a text reply from the selected model; its wording and quality depend on that model. Before asking about project files, decide whether to trust the workspace.',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed. Select the code to copy it.',
    exampleNote: "This static example requires a running OpenAI-compatible server and a model ID loaded there. The local port is illustrative. The 'local' API key is a placeholder for servers without authentication; replace it with your server's credential if required. A published-package loopback check verified the SDK call and cleanup; no real model answer is shown.",
    codeSource: 'Inspect the framework source',
    tasksEyebrow: 'Choose a first task',
    tasksTitle: 'Two practical ways in.',
    tasks: [
      {
        title: 'Build a query into your app',
        body: 'Install the framework and a provider adapter, then call createQuery from a Node.js script. Move to InteractiveSession when your own UI needs a longer conversation.',
        needs: 'You need Node.js 22.12+, a configured provider endpoint, and a model ID. The example on this page uses a running local OpenAI-compatible server.',
        action: 'Read the SDK guide',
      },
      {
        title: 'Ask the coding CLI about a project',
        body: 'Run the CLI, configure a provider and model with a hosted key or running local endpoint, then decide whether to trust the workspace before project context is loaded.',
        needs: 'You need Node.js 22.12+ and an API key or a running local model server. Provider costs and policies depend on the endpoint you choose.',
        action: 'Read CLI setup',
      },
    ],
    capabilitiesEyebrow: 'What you can configure',
    capabilitiesTitle: 'Controls at the boundary where they matter.',
    capabilities: [
      {
        title: 'Model endpoints',
        body: 'Inject a provider adapter for Anthropic or OpenAI-compatible endpoints; local servers need their own running model. Models and provider terms vary by setup.',
        link: 'Provider guide',
        href: '/en/guide/providers/',
      },
      {
        title: 'Tools and permissions',
        body: 'Use file, shell, and web tools with an explicit permission mode. In an unattended default-mode query, requests needing approval are denied unless a handler answers them.',
        link: 'Permission guide',
        href: '/en/guide/permissions-and-hooks/',
      },
      {
        title: 'Sessions',
        body: 'InteractiveSession handles turns and events. Persistence and resume need a session store supplied by the host; createQuery does not save a session by default.',
        link: 'Session guide',
        href: '/en/guide/sessions-and-daemon/',
      },
      {
        title: 'MCP connections',
        body: 'MCP support is available through separate transport and client components. Configure and authorize each connection before relying on its tools.',
        link: 'MCP guide',
        href: '/en/guide/mcp/',
      },
    ],
    fitEyebrow: 'Know the fit',
    fitTitle: 'Use the source. Understand the terms.',
    fitLead: 'A public codebase lets you inspect how the SDK and CLI are assembled. Start with the package and source that match your task.',
    fitItems: [
      {
        title: 'Open source and commercial paths',
        body: 'The code is offered under AGPL-3.0, with a commercial licensing path for uses that need different terms. Review the license for your distribution or service.',
      },
      {
        title: 'Provider costs are separate',
        body: 'The SDK and CLI do not include model inference. A hosted provider can charge for usage; local inference has its own compute and operating costs.',
      },
      {
        title: 'First-party showcase',
        body: 'The coding CLI is the maintained example of these public components composed into a developer tool. Browse its source and the current showcase.',
      },
    ],
    fitLink: 'Explore the showcase',
    visionEyebrow: 'Direction, not a guarantee',
    visionTitle: 'Our agents develop and advance our agents.',
    visionBody: 'That is the long-term direction of the project. Today, the usable foundation is an SDK and coding CLI with explicit providers, tools, and host decisions. Reliable autonomous self-development must be demonstrated through actual outcomes as the system evolves.',
    roadmapNote: 'Roadmap reviewed October 2026. Plans can change; the public beta is available now.',
    roadmapLink: 'View the roadmap',
    faqEyebrow: 'Before you start',
    faqTitle: 'Common questions.',
    faqs: [
      {
        question: 'Do I need the CLI to use the SDK?',
        answer: 'No. Import the agent framework into your own Node.js host and inject a provider. The CLI is one complete interface built from public components.',
      },
      {
        question: 'Will a query run without configuring a model?',
        answer: 'You need a provider endpoint and a suitable model. A local OpenAI-compatible example requires its server and model to be running; a hosted provider needs its own credentials and terms.',
      },
      {
        question: 'Does the SDK persist conversations automatically?',
        answer: 'No. A simple createQuery call is not a durable session. Supply a session store when your host needs save and resume behavior.',
      },
      {
        question: 'What should I read before enabling tools?',
        answer: 'Review project trust and permission modes. In default mode, an unattended request for approval is denied unless your host provides a permission handler.',
      },
    ],
    closeTitle: 'Start with one real task.',
    closeBody: 'Choose the embeddable query or set up the coding CLI. Both paths begin with the provider and access decisions you control.',
    sdkGuide: 'SDK guide (English)',
  },
  ko: {
    beta: '공개 베타',
    eyebrow: 'TypeScript 에이전트 SDK + 코딩 CLI',
    title: '에이전트를 사용하고, 같은 기반으로 직접 만드세요.',
    lead: 'SDK로 TypeScript 앱에 에이전트를 넣거나, 같은 공개 구성요소로 만든 코딩 CLI를 터미널에서 사용하세요. 작업에 맞게 모델 엔드포인트, 도구, 권한, 세션을 구성할 수 있습니다.',
    sdkAction: 'SDK 가이드(영문)',
    cliAction: 'CLI 사용하기',
    heroNote: '공개 패키지 · Node.js 22.12 이상 · 모델 엔드포인트 필요',
    heroVision: '에이전트가 자신의 시스템을 더 안정적으로 발전시킬 수 있는 기반을 만들어갑니다.',
    proofEyebrow: '공통 기반',
    proofTitle: '구성요소를 살펴보고 첫 질문을 실행하세요.',
    proofLead: 'agent-framework는 세션, 도구, 권한 검사를 조립합니다. 코딩 CLI는 이 기반 위에 만든 공식 인터페이스입니다. 프레임워크를 자체 Node.js 앱에서도 사용할 수 있습니다.',
    sdkLabel: '에이전트 프레임워크',
    cliLabel: '코딩 CLI',
    diagramCaption: '하나의 공개 TypeScript 기반에서 앱에 넣는 SDK와 터미널 인터페이스로 시작할 수 있습니다.',
    installLabel: 'SDK 패키지 설치',
    exampleLabel: 'TypeScript 단일 질문',
    cliCodeLabel: 'CLI 설정 개요',
    cliPromptIntro: '프로바이더와 모델을 설정한 뒤 일반 질문을 입력하세요:',
    cliExpectedReply: '선택한 모델의 텍스트 응답을 확인하세요. 답변 내용과 품질은 모델에 따라 다릅니다. 프로젝트 파일을 질문하기 전 작업 공간 신뢰 여부를 결정하세요.',
    copy: '복사',
    copied: '복사됨',
    copyFailed: '복사에 실패했습니다. 코드를 선택하여 복사하세요.',
    exampleNote: "이 정적 예제에는 실행 중인 OpenAI 호환 서버와 서버에 로드된 모델 ID가 필요합니다. 로컬 포트는 예시입니다. 'local' API 키는 인증이 없는 서버를 위한 임시 값이며, 서버에서 인증을 요구하면 해당 자격 증명으로 바꾸세요. 공개 패키지의 로컬 테스트로 SDK 호출과 종료를 확인했으며, 실제 모델 응답은 표시하지 않습니다.",
    codeSource: '프레임워크 소스 보기',
    tasksEyebrow: '첫 작업 선택',
    tasksTitle: '두 가지 시작 경로.',
    tasks: [
      {
        title: '앱에 질문 기능 넣기',
        body: '프레임워크와 프로바이더 어댑터를 설치한 뒤 Node.js 스크립트에서 createQuery를 호출하세요. 자체 UI에 긴 대화가 필요하면 InteractiveSession으로 확장할 수 있습니다.',
        needs: 'Node.js 22.12 이상, 설정한 프로바이더 엔드포인트, 모델 ID가 필요합니다. 이 페이지의 예제는 실행 중인 로컬 OpenAI 호환 서버를 사용합니다.',
        action: 'SDK 가이드(영문)',
      },
      {
        title: 'CLI로 프로젝트에 질문하기',
        body: 'CLI를 실행하고 호스팅 키 또는 실행 중인 로컬 엔드포인트로 프로바이더와 모델을 설정하세요. 프로젝트 문맥을 읽기 전 작업 공간 신뢰 여부를 결정합니다.',
        needs: 'Node.js 22.12 이상과 API 키 또는 실행 중인 로컬 모델 서버가 필요합니다. 프로바이더 비용과 정책은 선택한 엔드포인트에 따릅니다.',
        action: 'CLI 설정 가이드',
      },
    ],
    capabilitiesEyebrow: '설정 가능한 기능',
    capabilitiesTitle: '필요한 경계에서 직접 제어하세요.',
    capabilities: [
      {
        title: '모델 엔드포인트',
        body: 'Anthropic 또는 OpenAI 호환 엔드포인트용 프로바이더 어댑터를 주입합니다. 로컬 서버에는 실행 중인 모델이 필요하며, 모델과 제공 조건은 설정에 따라 다릅니다.',
        link: '프로바이더 가이드(영문)',
        href: '/en/guide/providers/',
      },
      {
        title: '도구와 권한',
        body: '파일, 셸, 웹 도구를 명시적인 권한 모드로 사용합니다. 기본 모드의 무인 실행에서 승인이 필요한 요청은 처리기가 응답하지 않으면 거부됩니다.',
        link: '권한 가이드(영문)',
        href: '/en/guide/permissions-and-hooks/',
      },
      {
        title: '세션',
        body: 'InteractiveSession은 턴과 이벤트를 다룹니다. 저장과 재개에는 호스트가 제공하는 세션 저장소가 필요하며, createQuery는 기본적으로 세션을 저장하지 않습니다.',
        link: '세션 가이드(영문)',
        href: '/en/guide/sessions-and-daemon/',
      },
      {
        title: 'MCP 연결',
        body: '별도의 전송·클라이언트 구성요소로 MCP를 사용할 수 있습니다. 연결 도구를 사용하기 전에 각 연결을 설정하고 승인해야 합니다.',
        link: 'MCP 가이드(영문)',
        href: '/en/guide/mcp/',
      },
    ],
    fitEyebrow: '적합성 확인',
    fitTitle: '소스를 확인하고 사용 조건을 이해하세요.',
    fitLead: '공개 소스에서 SDK와 CLI가 어떻게 조립되는지 볼 수 있습니다. 작업에 맞는 패키지와 소스부터 살펴보세요.',
    fitItems: [
      {
        title: '오픈소스 및 상용 라이선스',
        body: '코드는 AGPL-3.0으로 제공되며 다른 조건이 필요한 사용을 위한 상용 라이선스 경로도 있습니다. 배포 또는 서비스에 적용되는 조건을 검토하세요.',
      },
      {
        title: '모델 비용은 별도',
        body: 'SDK와 CLI에는 모델 추론이 포함되지 않습니다. 호스팅 프로바이더는 사용량에 따라 과금할 수 있고, 로컬 추론에도 연산 및 운영 비용이 듭니다.',
      },
      {
        title: '공식 쇼케이스',
        body: '코딩 CLI는 공개 구성요소를 개발자 도구로 조립한 공식 사례입니다. 소스와 현재 쇼케이스를 확인하세요.',
      },
    ],
    fitLink: '쇼케이스 보기',
    visionEyebrow: '방향이지 보장은 아닙니다',
    visionTitle: '우리의 에이전트가 우리의 에이전트를 발전시킵니다.',
    visionBody: '이것이 프로젝트의 장기적인 방향입니다. 지금 사용할 수 있는 것은 프로바이더, 도구, 호스트의 선택을 명시하는 SDK와 코딩 CLI입니다. 안정적인 자율 발전은 시스템이 발전하면서 실제 결과로 입증해야 합니다.',
    roadmapNote: '로드맵 검토: 2026년 10월. 계획은 바뀔 수 있으며 현재 공개 베타를 사용할 수 있습니다.',
    roadmapLink: '로드맵 보기',
    faqEyebrow: '시작 전 확인',
    faqTitle: '자주 묻는 질문.',
    faqs: [
      {
        question: 'SDK를 쓰려면 CLI가 필요한가요?',
        answer: '아니요. 자체 Node.js 호스트에서 agent-framework를 가져오고 프로바이더를 주입할 수 있습니다. CLI는 공개 구성요소로 만든 완성형 인터페이스 중 하나입니다.',
      },
      {
        question: '모델 설정 없이 질문을 실행할 수 있나요?',
        answer: '프로바이더 엔드포인트와 적절한 모델이 필요합니다. 로컬 OpenAI 호환 예제에는 실행 중인 서버와 모델이, 호스팅 프로바이더에는 해당 자격 증명과 이용 조건이 필요합니다.',
      },
      {
        question: 'SDK가 대화를 자동으로 저장하나요?',
        answer: '아니요. 간단한 createQuery 호출은 영구 세션이 아닙니다. 저장과 재개가 필요하면 호스트에서 세션 저장소를 제공해야 합니다.',
      },
      {
        question: '도구를 켜기 전에 무엇을 확인해야 하나요?',
        answer: '프로젝트 신뢰와 권한 모드를 검토하세요. 기본 모드에서 승인 처리기가 없는 무인 실행은 승인이 필요한 요청을 거부합니다.',
      },
    ],
    closeTitle: '실제 작업 하나로 시작하세요.',
    closeBody: '앱에 넣는 질문 기능 또는 코딩 CLI 설정을 선택하세요. 두 경로 모두 직접 제어하는 프로바이더와 접근 권한 결정에서 시작합니다.',
    sdkGuide: 'SDK 가이드(영문)',
  },
};

const sdkInstall = 'npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-openai';
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

export function HomePageContent({ locale }: { locale: MarketingLocale }) {
  const t = copy[locale];
  const identity = productPublicConfig.identity;
  const docsUrl = identity.docsUrl?.replace(/\/+$/u, '');
  const repoUrl = identity.repositoryUrl?.replace(/\/+$/u, '');
  const sdkGuideUrl = docsUrl
    ? `${docsUrl}/en/guide/sdk/`
    : 'https://www.npmjs.com/package/@robota-sdk/agent-framework';
  const cliGuideUrl = docsUrl
    ? `${docsUrl}/${locale}/getting-started/`
    : 'https://www.npmjs.com/package/@robota-sdk/agent-cli';
  const cliCode = 'npx @robota-sdk/agent-cli';

  return (
    <div className="homepage">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-container home-hero-inner">
          <div className="home-eyebrow"><span className="home-status-dot" />{t.beta}<span className="home-eyebrow-divider" />{t.eyebrow}</div>
          <h1 id="home-title">{t.title}</h1>
          <p className="home-hero-lead">{t.lead}</p>
          <div className="home-actions">
            <a className="home-button home-button-primary" href={sdkGuideUrl}>{t.sdkAction}<span aria-hidden="true">↗</span></a>
            <a className="home-button home-button-secondary" href={cliGuideUrl}>{t.cliAction}<span aria-hidden="true">↗</span></a>
          </div>
          <p className="home-hero-note">{t.heroNote}</p>
          <p className="home-hero-vision">{t.heroVision}</p>
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
              <CodeBlock code={sdkInstall} label={t.installLabel} copyLabel={t.copy} copiedLabel={t.copied} failureLabel={t.copyFailed} />
              <CodeBlock code={sdkExample} label={t.exampleLabel} copyLabel={t.copy} copiedLabel={t.copied} failureLabel={t.copyFailed} />
              <p className="home-code-note">{t.exampleNote}</p>
              {repoUrl && <a className="home-text-link" href={`${repoUrl}/blob/main/packages/agent-framework/README.md`}>{t.codeSource} <span aria-hidden="true">↗</span></a>}
            </div>
            <div className="home-cli-aside">
              <p className="home-aside-label">02 / {t.cliLabel}</p>
              <CodeBlock code={cliCode} label={t.cliCodeLabel} copyLabel={t.copy} copiedLabel={t.copied} failureLabel={t.copyFailed} />
              <p>{t.tasks[1].needs}</p>
              <p>{t.cliPromptIntro}</p>
              <p className="home-cli-prompt"><code>Reply with one sentence.</code></p>
              <p>{t.cliExpectedReply}</p>
              <a className="home-text-link" href={cliGuideUrl}>{t.tasks[1].action} <span aria-hidden="true">↗</span></a>
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
              <div className="home-prereq"><strong>{locale === 'ko' ? '시작 조건' : 'Before you run it'}</strong><p>{task.needs}</p></div>
              <a className="home-text-link" href={index === 0 ? sdkGuideUrl : cliGuideUrl}>{task.action} <span aria-hidden="true">↗</span></a>
            </article>)}
          </div>
        </div>
      </section>

      <section className="home-section home-capabilities" aria-labelledby="capabilities-title">
        <div className="home-container">
          <div className="home-section-heading"><p className="home-kicker">03 / {t.capabilitiesEyebrow}</p><h2 id="capabilities-title">{t.capabilitiesTitle}</h2></div>
          <div className="home-capability-grid">
            {t.capabilities.map((item, index) => <article className="home-capability" key={item.title}>
              <span className="home-card-index">0{index + 1}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              {docsUrl && <a className="home-text-link" href={`${docsUrl}${item.href}`}>{item.link} <span aria-hidden="true">↗</span></a>}
            </article>)}
          </div>
        </div>
      </section>

      <section className="home-section home-fit" aria-labelledby="fit-title">
        <div className="home-container home-fit-grid">
          <div className="home-section-heading"><p className="home-kicker">04 / {t.fitEyebrow}</p><h2 id="fit-title">{t.fitTitle}</h2><p>{t.fitLead}</p><a className="home-text-link" href={marketingPath(locale, 'showcase')}>{t.fitLink} <span aria-hidden="true">↗</span></a></div>
          <div className="home-fit-list">{t.fitItems.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
        </div>
      </section>

      <section className="home-section home-vision" aria-labelledby="vision-title">
        <div className="home-container"><p className="home-kicker">05 / {t.visionEyebrow}</p><h2 id="vision-title">{t.visionTitle}</h2><p>{t.visionBody}</p><div className="home-vision-footer"><span>{t.roadmapNote}</span><a className="home-text-link" href={marketingPath(locale, 'roadmap')}>{t.roadmapLink} <span aria-hidden="true">↗</span></a></div></div>
      </section>

      <section className="home-section home-faq" aria-labelledby="faq-title">
        <div className="home-container home-faq-grid"><div className="home-section-heading"><p className="home-kicker">06 / {t.faqEyebrow}</p><h2 id="faq-title">{t.faqTitle}</h2></div><div className="home-faq-list">{t.faqs.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></div>
      </section>

      <section className="home-final" aria-labelledby="close-title"><div className="home-container"><h2 id="close-title">{t.closeTitle}</h2><p>{t.closeBody}</p><div className="home-actions"><a className="home-button home-button-primary" href={sdkGuideUrl}>{t.sdkGuide}<span aria-hidden="true">↗</span></a><a className="home-button home-button-secondary" href={cliGuideUrl}>{t.tasks[1].action}<span aria-hidden="true">↗</span></a></div></div></section>
    </div>
  );
}
