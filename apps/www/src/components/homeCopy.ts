import type { MarketingLocale } from '@/lib/marketing';
import type { ArchitectureLayerId, FeatureGroupId, FeatureId, PackageGroupId, PermissionMode } from './homeCatalog';

type Titled = { title: string; body: string };

export type HomeCopy = {
  beta: string;
  eyebrow: string;
  title: string;
  lead: string;
  sdkAction: string;
  cliAction: string;
  heroNote: string;
  heroVision: string;
  jumpLabel: string;
  jumpLinks: { features: string; cli: string; safety: string; architecture: string; install: string };
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
  prereqLabel: string;
  tasks: readonly { title: string; body: string; needs: string; action: string }[];
  featuresEyebrow: string;
  featuresTitle: string;
  featuresLead: string;
  guideLink: string;
  featureGroups: Record<FeatureGroupId, Titled>;
  features: Record<FeatureId, Titled>;
  cliEyebrow: string;
  cliTitle: string;
  cliLead: string;
  cliFlows: readonly Titled[];
  cliGuideLink: string;
  safetyEyebrow: string;
  safetyTitle: string;
  safetyLead: string;
  modeTableCaption: string;
  modeHeaders: readonly [string, string, string, string];
  modes: Record<PermissionMode, readonly [string, string, string]>;
  rulesLabel: string;
  safetyNotes: readonly Titled[];
  safetyLink: string;
  architectureEyebrow: string;
  architectureTitle: string;
  architectureLead: string;
  layers: Record<ArchitectureLayerId, string>;
  architectureLink: string;
  packagesTitle: string;
  packagesLead: string;
  packageGroups: Record<PackageGroupId, Titled>;
  packagesLink: string;
  installEyebrow: string;
  installTitle: string;
  installLead: string;
  installOptions: { npx: Titled; global: Titled; binary: Titled; sdk: Titled };
  binaryUnix: string;
  binaryWindows: string;
  releasesLink: string;
  fitEyebrow: string;
  fitTitle: string;
  fitLead: string;
  fitItems: readonly Titled[];
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

export const homeCopy: Record<MarketingLocale, HomeCopy> = {
  en: {
    beta: 'Public beta',
    eyebrow: 'TypeScript agent SDK + coding CLI',
    title: 'One foundation for agents you use and agents you build.',
    lead: 'Build an agent into your TypeScript application with the SDK. Or work in your terminal with the coding CLI built from the same public components. Configure a model endpoint, tools, permissions, and sessions for the task at hand.',
    sdkAction: 'Build with the SDK',
    cliAction: 'Try the CLI',
    heroNote: 'Public packages · Node.js 22.12 or later · Bring a model endpoint',
    heroVision: 'Our direction: agents that can reliably advance the systems they are built on.',
    jumpLabel: 'On this page',
    jumpLinks: { features: 'Features', cli: 'CLI', safety: 'Permissions', architecture: 'Architecture', install: 'Install' },
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
    prereqLabel: 'Before you run it',
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
    featuresEyebrow: 'Everything in the foundation',
    featuresTitle: 'What ships today.',
    featuresLead: 'Every capability below is part of the public SDK packages or the coding CLI built from them. Each card names the package, class, flag, or command to look for and links to the guide that owns the details.',
    guideLink: 'Guide',
    featureGroups: {
      models: { title: 'Models and providers', body: 'Choose the model per task, and keep a turn going when one fails.' },
      safety: { title: 'Tools and safety', body: 'Typed tools, with every call checked before it runs.' },
      sessions: { title: 'Sessions and execution', body: 'Long-running work that survives the terminal and splits across agents.' },
      extend: { title: 'Connect and extend', body: 'Bring in servers, skills, and plugins without forking the runtime.' },
      interfaces: { title: 'Interfaces', body: 'The same session behind a terminal, a script, a browser, or a protocol.' },
      build: { title: 'Build your own', body: 'Use the layers directly, or assemble a product of your own on them.' },
    },
    features: {
      providers: { title: 'Multi-provider adapters', body: 'Provider packages for Anthropic, OpenAI, Google Gemini, DeepSeek, Qwen and Gemma, plus any OpenAI-compatible endpoint (gateways, Azure, vLLM, local servers) through baseURL.' },
      fallback: { title: 'Fallback, effort and advisor', body: 'FallbackProvider moves a turn to another model when the primary is overloaded or failing. The CLI adds per-run model effort and an advisor model the agent can consult.' },
      local: { title: 'Local models', body: 'Point a provider profile at an Ollama, LM Studio or other OpenAI-compatible server on your own machine or network. You run the model; enabled tools decide what else leaves it.' },
      media: { title: 'Image and video generation', body: 'The Gemini provider includes image generation, and the ByteDance (ModelArk) provider generates video, behind the same provider contract.' },
      tools: { title: 'Validated tools', body: 'createZodFunctionTool checks model arguments against a zod schema before your function runs. Built-in coding tools cover files, search, shell, web fetch and web search.' },
      permissions: { title: 'Permission modes and rules', body: 'Every tool call passes deny, ask and allow rules, then one of five permission modes. A few destructive actions are never approved automatically in any mode.' },
      hooks: { title: 'Lifecycle hooks', body: 'Run commands on tool, prompt and session events. PreToolUse can block a call; other hooks log, audit, or add context to the next prompt.' },
      sandbox: { title: 'OS sandbox for shell', body: 'Shell commands can run inside bubblewrap on Linux and WSL2 or Seatbelt on macOS, limiting what a command can read, write, or reach on the network.' },
      trust: { title: 'Workspace trust', body: 'Project instructions such as AGENTS.md and CLAUDE.md load only in a trusted workspace. An untrusted repository refuses unattended runs or starts them Restricted.' },
      sessions: { title: 'Saved, resumable sessions', body: 'Continue, resume, rename or fork a conversation. Context is tracked and compacted automatically; the SDK host supplies the session store it wants.' },
      daemon: { title: 'Background sessions and daemon', body: 'Supervised sessions keep running after the terminal closes. One workspace daemon serves several terminals and the desktop app from a single runtime.' },
      subagents: { title: 'Subagents and background tasks', body: 'Delegate work to subagents with their own context and tools, in process or in child processes, and manage queued and running jobs from one place.' },
      automation: { title: 'Loops, schedules and plans', body: 'Repeat a prompt on a cadence, wake the agent later or when command output matches, and keep a session read-only until you approve its plan.' },
      checkpoints: { title: 'Checkpoints, memory and cost', body: 'Rewind or fork from edit checkpoints, keep approved facts across sessions with opt-in memory, inspect context use, and set a monthly cost budget.' },
      workflows: { title: 'DAG workflows', body: '/workflows designs a workflow from a description with the active model, saves it as JSON in the workspace, validates it and runs it, optionally detached.' },
      roundtable: { title: 'Multi-agent roundtables', body: 'Coordinate independent agents and people in one shared transcript: select turns, run parallel groups, and plug a Robota session in as a participant or selector.' },
      mcp: { title: 'MCP in both directions', body: 'Connect to stdio or remote MCP servers, including OAuth sign-in, after explicit approval. Or serve a session as an MCP server over stdio or authenticated HTTP.' },
      skills: { title: 'Skills, commands and agents', body: 'Markdown skills and commands become slash commands; agent definitions describe subagents. They are discovered in the project and your home directory.' },
      plugins: { title: 'Plugins and marketplaces', body: 'Install plugins that bundle skills, hooks, themes and MCP servers. SDK lifecycle plugins cover history, logging, usage, limits, errors, analytics and webhooks.' },
      events: { title: 'External events', body: 'Grant a verified outside service permission to send text events into a running terminal session, and list or revoke those grants from the session.' },
      terminal: { title: 'Terminal UI', body: 'An interactive terminal app with a command menu, prompt history search, rebindable keys, file attachments with @path, and a plain-text screen-reader mode.' },
      print: { title: 'Print mode and goals', body: 'Run one prompt from a script or pipe, get text, JSON or streaming JSON, request schema-shaped output, or work toward a goal over several turns.' },
      gui: { title: 'Browser GUI and desktop app', body: 'Serve the GUI for the current workspace on loopback and open it in a browser. The desktop app in the repository shows the same GUI over the workspace daemon.' },
      http: { title: 'Serve over HTTP and transports', body: 'Let other services submit turns and stream results as server-sent events, behind a bearer token or as an OAuth resource server. WebSocket, HTTP, MCP and WebRTC carriers share one wire protocol.' },
      devices: { title: 'Devices and remote control', body: 'Message other live sessions, hand a conversation to another session or device, link your own devices, and co-drive a session from a paired browser over peer-to-peer WebRTC.' },
      ci: { title: 'CI and GitHub Actions', body: 'Run print mode in a workflow step to review a pull request or answer a task, and gate a pipeline on an evals-as-code score.' },
      core: { title: 'Conversation engine', body: 'ConversationAgent runs and streams turns with history, tool calling, structured output and plugins. It is the minimal set: core plus one provider.' },
      framework: { title: 'Framework assembly', body: 'createQuery runs one-shot queries with built-in tools and permissions; InteractiveSession drives a full conversation; createAgentRuntime assembles a host runtime.' },
      product: { title: 'Product composition', body: 'assembleProduct builds a product from a declarative profile. Capability packs, slash-command modules, presets and output styles are the parts the coding CLI uses.' },
      analytics: { title: 'Diagnostics, usage and evals', body: 'Check settings, provider, trust and plugins in one report; summarize local token use and cost without sending content; export content-free metrics; run evals as code.' },
    },
    cliEyebrow: 'The coding CLI',
    cliTitle: 'A full agent in your terminal.',
    cliLead: 'The CLI is the maintained interface on the shared foundation. The same runtime powers the terminal UI, scripts, background sessions, the browser GUI, and other services.',
    cliFlows: [
      { title: 'Work interactively', body: 'Start a session, choose a permission mode, or switch to a screen-reader mode.' },
      { title: 'Script a single prompt', body: 'Print mode exits with a code your script can check. A goal run keeps working over several turns.' },
      { title: 'Keep sessions running', body: 'Resume earlier work, run supervised sessions in the background, and share one daemon.' },
      { title: 'Serve it to other surfaces', body: 'Open the browser GUI, accept HTTP clients with a bearer token, or act as an MCP server.' },
      { title: 'Reach your other sessions', body: 'Inside a session: message peers, hand off a conversation, link devices, pair a browser.' },
      { title: 'Check setup and usage', body: 'Diagnose configuration, summarize local usage, check for updates, and run evals.' },
    ],
    cliGuideLink: 'Read the CLI reference',
    safetyEyebrow: 'Permissions and safety',
    safetyTitle: 'Decide what the agent may do.',
    safetyLead: 'Deny, ask and allow rules are checked first, then the permission mode. Set the mode per run or change it inside a session.',
    modeTableCaption: 'What each permission mode allows',
    modeHeaders: ['Mode', 'Reads', 'File edits', 'Shell commands'],
    modes: {
      plan: ['Yes', 'Refused', 'Refused, except built-in read-only commands'],
      default: ['Yes', 'Asks', 'Asks'],
      acceptEdits: ['Yes', 'Yes', 'Asks'],
      auto: ['Yes', 'Yes', 'Decided by a model classifier'],
      bypassPermissions: ['Yes', 'Yes', 'Yes'],
    },
    rulesLabel: 'Rules in a settings file',
    safetyNotes: [
      { title: 'Rules win over modes', body: 'An ask rule still asks in bypassPermissions. Removing the root, home or working directory, and writing into .git or tool configuration, are never approved automatically.' },
      { title: 'Unattended means denied', body: 'In default mode, a request that needs approval is denied when nobody answers it, unless your host supplies a permission handler.' },
      { title: 'Sandboxed shell', body: 'Combine permission rules with the OS sandbox so an approved command still runs with limited file and network access.' },
    ],
    safetyLink: 'Read the permissions and hooks guide',
    architectureEyebrow: 'Architecture',
    architectureTitle: 'Libraries below, products on top.',
    architectureLead: 'Everything under packages/ is neutral and reusable; the CLI and apps are opinionated assemblies of those libraries. Each layer builds only on the layers below it.',
    layers: {
      interface: 'Product interface: the terminal coding assistant',
      composition: 'Product composition: profiles, capability packs, commands, presets',
      surfaces: 'Terminal UI and carriers over the shared wire protocol',
      assembly: 'Assembly: InteractiveSession, createQuery, createAgentRuntime',
      runtime: 'Runtime: sessions, background tasks, tools, MCP client, plugins',
      providers: 'One provider package per vendor',
      contracts: 'Type-only contracts shared across layers',
      foundation: 'Foundation: the conversation engine and its contracts',
    },
    architectureLink: 'Read the architecture guide',
    packagesTitle: 'Published packages',
    packagesLead: 'Every package is published on npm under @robota-sdk/ and shares one version. Start with the smallest set your task needs.',
    packageGroups: {
      start: { title: 'Start here', body: 'The engine, one provider per vendor, and validated tools.' },
      assembly: { title: 'App assembly', body: 'Sessions, permissions, background work, MCP, plugins and analysis.' },
      multiAgent: { title: 'Multi-agent conversation', body: 'Shared transcripts for independent agents and people.' },
      composition: { title: 'Product composition', body: 'Build your own product on the same runtime.' },
      transports: { title: 'Transports and UI', body: 'Put a session behind a protocol or a screen.' },
      contracts: { title: 'Contracts', body: 'Type-only packages shared across layers.' },
      cli: { title: 'Agent interface', body: 'The coding CLI, published as a self-contained bundle.' },
    },
    packagesLink: 'Browse the package index',
    installEyebrow: 'Install',
    installTitle: 'Pick how you want to run it.',
    installLead: 'Published packages need Node.js 22.12 or later. The standalone binary needs nothing else installed.',
    installOptions: {
      npx: { title: 'Run without installing', body: 'Fetch and start the latest CLI with npx.' },
      global: { title: 'Install globally', body: 'Keep the CLI on your PATH with npm.' },
      binary: { title: 'Standalone binary', body: 'The installer picks the binary for your OS and CPU from the latest release and verifies its SHA-256 checksum. Binaries are unsigned, so macOS and Windows may warn.' },
      sdk: { title: 'Embed the minimal SDK', body: 'The engine plus one provider package. Add agent-tools when the agent calls tools.' },
    },
    binaryUnix: 'macOS / Linux',
    binaryWindows: 'Windows PowerShell',
    releasesLink: 'See all releases',
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
      {
        question: 'Is the beta API stable?',
        answer: 'Not yet. The packages are 3.0.0 beta releases and APIs may change before a stable release; the changelog records upgrade notes.',
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
    jumpLabel: '이 페이지에서',
    jumpLinks: { features: '기능', cli: 'CLI', safety: '권한', architecture: '구조', install: '설치' },
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
    prereqLabel: '시작 조건',
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
    featuresEyebrow: '기반에 들어 있는 기능',
    featuresTitle: '지금 쓸 수 있는 기능.',
    featuresLead: '아래 기능은 모두 공개 SDK 패키지나 그 패키지로 만든 코딩 CLI에 들어 있습니다. 카드마다 찾아볼 패키지, 클래스, 플래그, 명령 이름을 적고, 자세한 내용을 다루는 가이드로 연결했습니다.',
    guideLink: '가이드(영문)',
    featureGroups: {
      models: { title: '모델과 프로바이더', body: '작업마다 모델을 고르고, 한 모델이 실패해도 턴을 이어갑니다.' },
      safety: { title: '도구와 안전장치', body: '타입이 있는 도구를 쓰고, 모든 호출을 실행 전에 검사합니다.' },
      sessions: { title: '세션과 실행', body: '터미널을 닫아도 이어지는 작업, 여러 에이전트로 나누는 작업.' },
      extend: { title: '연결과 확장', body: '런타임을 고치지 않고 서버, 스킬, 플러그인을 붙입니다.' },
      interfaces: { title: '인터페이스', body: '같은 세션을 터미널, 스크립트, 브라우저, 프로토콜로 씁니다.' },
      build: { title: '직접 만들기', body: '각 계층을 그대로 쓰거나, 그 위에 자신만의 제품을 조립합니다.' },
    },
    features: {
      providers: { title: '여러 프로바이더 어댑터', body: 'Anthropic, OpenAI, Google Gemini, DeepSeek, Qwen, Gemma용 프로바이더 패키지가 있고, baseURL로 OpenAI 호환 엔드포인트(게이트웨이, Azure, vLLM, 로컬 서버)에도 연결할 수 있습니다.' },
      fallback: { title: '폴백, effort, 어드바이저', body: 'FallbackProvider는 기본 모델이 과부하이거나 실패하면 턴을 다른 모델로 넘깁니다. CLI에서는 실행마다 모델 effort를 정하고, 에이전트가 참고할 어드바이저 모델을 둘 수 있습니다.' },
      local: { title: '로컬 모델', body: '프로바이더 프로필을 내 컴퓨터나 내부망의 Ollama, LM Studio 등 OpenAI 호환 서버로 지정하세요. 모델은 직접 실행하며, 그 밖에 무엇이 외부로 나가는지는 켜 둔 도구가 정합니다.' },
      media: { title: '이미지와 영상 생성', body: 'Gemini 프로바이더는 이미지 생성을, ByteDance(ModelArk) 프로바이더는 영상 생성을 같은 프로바이더 계약으로 제공합니다.' },
      tools: { title: '검증되는 도구', body: 'createZodFunctionTool은 함수를 실행하기 전에 모델이 넘긴 인자를 zod 스키마로 검사합니다. 기본 코딩 도구로 파일, 검색, 셸, 웹 가져오기, 웹 검색을 다룹니다.' },
      permissions: { title: '권한 모드와 규칙', body: '모든 도구 호출은 deny, ask, allow 규칙을 거친 뒤 다섯 가지 권한 모드 중 하나로 판정됩니다. 일부 파괴적인 동작은 어떤 모드에서도 자동 승인되지 않습니다.' },
      hooks: { title: '라이프사이클 훅', body: '도구, 프롬프트, 세션 이벤트에 명령을 실행합니다. PreToolUse는 호출을 막을 수 있고, 나머지 훅은 기록, 감사, 다음 프롬프트에 문맥 추가에 씁니다.' },
      sandbox: { title: '셸용 OS 샌드박스', body: '셸 명령을 Linux·WSL2에서는 bubblewrap, macOS에서는 Seatbelt 안에서 실행해 명령이 읽고 쓰고 접속할 수 있는 범위를 제한합니다.' },
      trust: { title: '작업 공간 신뢰', body: 'AGENTS.md, CLAUDE.md 같은 프로젝트 지침은 신뢰한 작업 공간에서만 읽습니다. 신뢰하지 않은 저장소에서는 무인 실행을 거부하거나 Restricted로 시작합니다.' },
      sessions: { title: '저장하고 이어가는 세션', body: '대화를 이어가고, 재개하고, 이름을 붙이고, 복제할 수 있습니다. 문맥 사용량을 추적해 자동으로 압축하며, SDK에서는 호스트가 원하는 세션 저장소를 제공합니다.' },
      daemon: { title: '백그라운드 세션과 데몬', body: '감독 세션은 터미널을 닫은 뒤에도 계속 실행됩니다. 작업 공간 데몬 하나가 여러 터미널과 데스크톱 앱에 같은 런타임을 제공합니다.' },
      subagents: { title: '서브에이전트와 백그라운드 작업', body: '독립된 문맥과 도구를 가진 서브에이전트에게 작업을 맡기세요. 같은 프로세스나 자식 프로세스에서 실행하며, 대기 중이거나 실행 중인 작업을 한곳에서 관리합니다.' },
      automation: { title: '반복, 예약, 계획', body: '정해진 간격으로 프롬프트를 반복하고, 나중에 또는 명령 출력이 일치할 때 에이전트를 깨우고, 계획을 승인하기 전까지 세션을 읽기 전용으로 둡니다.' },
      checkpoints: { title: '체크포인트, 메모리, 비용', body: '편집 체크포인트로 되돌리거나 분기하고, 선택형 메모리로 승인한 사실을 세션 사이에 유지하고, 문맥 사용량을 확인하고, 월 비용 한도를 정합니다.' },
      workflows: { title: 'DAG 워크플로', body: '/workflows는 설명을 받아 활성 모델로 워크플로를 설계하고, 작업 공간에 JSON으로 저장하고, 검증한 뒤 실행합니다. 분리 실행도 가능합니다.' },
      roundtable: { title: '멀티에이전트 라운드테이블', body: '독립된 에이전트와 사람을 하나의 공유 대화록에 모읍니다. 발언 순서를 고르고, 병렬 그룹을 실행하고, Robota 세션을 참가자나 선택자로 붙일 수 있습니다.' },
      mcp: { title: '양방향 MCP', body: '명시적으로 승인한 뒤 stdio 또는 원격 MCP 서버에 연결하며, OAuth 로그인도 지원합니다. 반대로 세션을 stdio나 인증된 HTTP로 MCP 서버처럼 제공할 수도 있습니다.' },
      skills: { title: '스킬, 명령, 에이전트', body: 'Markdown으로 쓴 스킬과 명령은 슬래시 명령이 되고, 에이전트 정의는 서브에이전트를 설명합니다. 프로젝트와 홈 디렉터리에서 찾아 읽습니다.' },
      plugins: { title: '플러그인과 마켓플레이스', body: '스킬, 훅, 테마, MCP 서버를 묶은 플러그인을 설치하세요. SDK 라이프사이클 플러그인은 기록, 로깅, 사용량, 한도, 오류, 분석, 웹훅을 다룹니다.' },
      events: { title: '외부 이벤트', body: '검증된 외부 서비스가 실행 중인 터미널 세션에 텍스트 이벤트를 보내도록 허가하고, 세션 안에서 허가 목록을 보거나 취소합니다.' },
      terminal: { title: '터미널 UI', body: '명령 메뉴, 프롬프트 기록 검색, 키 재지정, @path 파일 첨부, 화면 낭독기용 일반 텍스트 모드를 갖춘 대화형 터미널 앱입니다.' },
      print: { title: '출력 모드와 목표 실행', body: '스크립트나 파이프에서 프롬프트 하나를 실행해 텍스트, JSON, 스트리밍 JSON으로 받고, 스키마에 맞춘 출력을 요청하거나, 여러 턴에 걸쳐 목표를 향해 작업합니다.' },
      gui: { title: '브라우저 GUI와 데스크톱 앱', body: '현재 작업 공간의 GUI를 루프백 주소로 띄워 브라우저에서 엽니다. 저장소의 데스크톱 앱은 작업 공간 데몬 위에서 같은 GUI를 보여줍니다.' },
      http: { title: 'HTTP 제공과 전송 계층', body: '다른 서비스가 턴을 제출하고 결과를 server-sent events로 받게 합니다. bearer 토큰이나 OAuth 리소스 서버로 보호합니다. WebSocket, HTTP, MCP, WebRTC 전송이 하나의 와이어 프로토콜을 공유합니다.' },
      devices: { title: '기기와 원격 제어', body: '실행 중인 다른 세션에 메시지를 보내고, 대화를 다른 세션이나 기기로 넘기고, 내 기기들을 연결하고, 페어링한 브라우저에서 P2P WebRTC로 세션을 함께 조작합니다.' },
      ci: { title: 'CI와 GitHub Actions', body: '워크플로 단계에서 출력 모드를 실행해 PR을 리뷰하거나 작업에 답하고, evals-as-code 점수로 파이프라인을 막을 수 있습니다.' },
      core: { title: '대화 엔진', body: 'ConversationAgent는 기록, 도구 호출, 구조화된 출력, 플러그인과 함께 턴을 실행하고 스트리밍합니다. 최소 구성은 core와 프로바이더 하나입니다.' },
      framework: { title: '프레임워크 조립', body: 'createQuery는 기본 도구와 권한을 갖춘 단일 질문을 실행하고, InteractiveSession은 전체 대화를 다루고, createAgentRuntime은 호스트 런타임을 조립합니다.' },
      product: { title: '제품 조립', body: 'assembleProduct는 선언형 프로필로 제품을 만듭니다. 능력 팩, 슬래시 명령 모듈, 프리셋, 출력 스타일은 코딩 CLI가 쓰는 부품 그대로입니다.' },
      analytics: { title: '진단, 사용량, 평가', body: '설정, 프로바이더, 신뢰, 플러그인을 한 보고서로 점검하고, 내용을 보내지 않고 로컬 토큰 사용량과 비용을 요약하고, 내용 없는 지표를 내보내고, 평가를 코드로 실행합니다.' },
    },
    cliEyebrow: '코딩 CLI',
    cliTitle: '터미널 안의 완전한 에이전트.',
    cliLead: 'CLI는 공통 기반 위에 만든 공식 인터페이스입니다. 같은 런타임이 터미널 UI, 스크립트, 백그라운드 세션, 브라우저 GUI, 다른 서비스를 모두 처리합니다.',
    cliFlows: [
      { title: '대화하며 작업하기', body: '세션을 시작하고, 권한 모드를 고르거나 화면 낭독기 모드로 바꿉니다.' },
      { title: '프롬프트 하나를 스크립트로', body: '출력 모드는 스크립트가 확인할 수 있는 종료 코드를 남깁니다. 목표 실행은 여러 턴 동안 작업을 이어갑니다.' },
      { title: '세션 유지하기', body: '이전 작업을 재개하고, 감독 세션을 백그라운드로 돌리고, 데몬 하나를 함께 씁니다.' },
      { title: '다른 화면과 서비스에 제공하기', body: '브라우저 GUI를 열거나, bearer 토큰으로 HTTP 클라이언트를 받거나, MCP 서버로 동작합니다.' },
      { title: '다른 세션과 기기에 닿기', body: '세션 안에서 다른 세션에 메시지를 보내고, 대화를 넘기고, 기기를 연결하고, 브라우저를 페어링합니다.' },
      { title: '설정과 사용량 점검하기', body: '설정을 진단하고, 로컬 사용량을 요약하고, 업데이트를 확인하고, 평가를 실행합니다.' },
    ],
    cliGuideLink: 'CLI 레퍼런스(영문)',
    safetyEyebrow: '권한과 안전',
    safetyTitle: '에이전트가 할 수 있는 일을 정하세요.',
    safetyLead: 'deny, ask, allow 규칙을 먼저 확인한 뒤 권한 모드를 적용합니다. 모드는 실행할 때 정하거나 세션 안에서 바꿀 수 있습니다.',
    modeTableCaption: '권한 모드별 허용 범위',
    modeHeaders: ['모드', '읽기', '파일 편집', '셸 명령'],
    modes: {
      plan: ['허용', '거부', '거부(기본 읽기 전용 명령 제외)'],
      default: ['허용', '확인 요청', '확인 요청'],
      acceptEdits: ['허용', '허용', '확인 요청'],
      auto: ['허용', '허용', '모델 분류기가 판단'],
      bypassPermissions: ['허용', '허용', '허용'],
    },
    rulesLabel: '설정 파일의 규칙',
    safetyNotes: [
      { title: '규칙이 모드보다 우선합니다', body: 'ask 규칙은 bypassPermissions에서도 확인을 요청합니다. 루트, 홈, 작업 디렉터리 삭제와 .git이나 도구 설정 파일 쓰기는 어떤 모드에서도 자동 승인되지 않습니다.' },
      { title: '응답이 없으면 거부합니다', body: 'default 모드에서 승인이 필요한 요청에 아무도 답하지 않으면 거부됩니다. 호스트가 권한 처리기를 제공하면 그 처리기가 답합니다.' },
      { title: '샌드박스 안의 셸', body: '권한 규칙과 OS 샌드박스를 함께 쓰면, 승인한 명령도 제한된 파일·네트워크 접근으로 실행됩니다.' },
    ],
    safetyLink: '권한과 훅 가이드(영문)',
    architectureEyebrow: '구조',
    architectureTitle: '아래는 라이브러리, 위는 제품.',
    architectureLead: 'packages/ 아래는 모두 중립적이고 재사용할 수 있는 라이브러리이고, CLI와 앱은 그 라이브러리를 특정 목적에 맞게 조립한 결과입니다. 각 계층은 아래 계층에만 의존합니다.',
    layers: {
      interface: '제품 인터페이스: 터미널 코딩 도우미',
      composition: '제품 조립: 프로필, 능력 팩, 명령, 프리셋',
      surfaces: '터미널 UI와 공유 와이어 프로토콜 위의 전송 계층',
      assembly: '조립: InteractiveSession, createQuery, createAgentRuntime',
      runtime: '런타임: 세션, 백그라운드 작업, 도구, MCP 클라이언트, 플러그인',
      providers: '벤더마다 하나의 프로바이더 패키지',
      contracts: '계층 사이에서 공유하는 타입 전용 계약',
      foundation: '기반: 대화 엔진과 그 계약',
    },
    architectureLink: '아키텍처 가이드(영문)',
    packagesTitle: '공개 패키지',
    packagesLead: '모든 패키지는 npm의 @robota-sdk/ 아래에 공개되어 있고 같은 버전을 씁니다. 작업에 필요한 가장 작은 조합부터 시작하세요.',
    packageGroups: {
      start: { title: '여기서 시작', body: '엔진, 벤더별 프로바이더, 검증되는 도구.' },
      assembly: { title: '앱 조립', body: '세션, 권한, 백그라운드 작업, MCP, 플러그인, 분석.' },
      multiAgent: { title: '멀티에이전트 대화', body: '독립된 에이전트와 사람이 함께 쓰는 대화록.' },
      composition: { title: '제품 조립', body: '같은 런타임 위에 자신만의 제품을 만듭니다.' },
      transports: { title: '전송과 UI', body: '세션을 프로토콜이나 화면 뒤에 둡니다.' },
      contracts: { title: '계약', body: '계층 사이에서 공유하는 타입 전용 패키지.' },
      cli: { title: '에이전트 인터페이스', body: '자체 포함 번들로 배포하는 코딩 CLI.' },
    },
    packagesLink: '패키지 목록(영문)',
    installEyebrow: '설치',
    installTitle: '실행 방법을 고르세요.',
    installLead: '공개 패키지에는 Node.js 22.12 이상이 필요합니다. 단독 실행 파일은 다른 설치가 필요 없습니다.',
    installOptions: {
      npx: { title: '설치 없이 실행', body: 'npx로 최신 CLI를 받아 바로 시작합니다.' },
      global: { title: '전역 설치', body: 'npm으로 CLI를 PATH에 설치합니다.' },
      binary: { title: '단독 실행 파일', body: '설치 스크립트가 최신 릴리스에서 OS와 CPU에 맞는 실행 파일을 받아 SHA-256 체크섬을 검증합니다. 서명되지 않은 파일이라 macOS와 Windows에서 경고가 나올 수 있습니다.' },
      sdk: { title: '최소 SDK 넣기', body: '엔진과 프로바이더 패키지 하나면 됩니다. 에이전트가 도구를 호출하면 agent-tools를 추가하세요.' },
    },
    binaryUnix: 'macOS / Linux',
    binaryWindows: 'Windows PowerShell',
    releasesLink: '전체 릴리스 보기',
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
      {
        question: '베타 API는 안정적인가요?',
        answer: '아직은 아닙니다. 패키지는 3.0.0 베타 릴리스이며 정식 릴리스 전에 API가 바뀔 수 있습니다. 업그레이드 안내는 변경 기록에 남깁니다.',
      },
    ],
    closeTitle: '실제 작업 하나로 시작하세요.',
    closeBody: '앱에 넣는 질문 기능 또는 코딩 CLI 설정을 선택하세요. 두 경로 모두 직접 제어하는 프로바이더와 접근 권한 결정에서 시작합니다.',
    sdkGuide: 'SDK 가이드(영문)',
  },
};
