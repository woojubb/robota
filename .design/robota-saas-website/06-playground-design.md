# Playground 기능 설계

## Playground 개요

### 핵심 목표
- **즉시 실행 가능한 환경**: 복잡한 설정 없이 바로 Robota SDK 체험
- **실시간 코드 생성**: AI 기반 코드 템플릿 생성 및 커스터마이징
- **학습 친화적**: 단계별 튜토리얼과 인터랙티브 가이드
- **공유 및 협업**: 코드 공유 및 커뮤니티 참여

## 아키텍처 설계

### 클라이언트 사이드 구조
```
┌─────────────────────────────────────────────────────────┐
│                    Playground App                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Template   │  │    Code     │  │   Output    │    │
│  │  Browser    │  │   Editor    │  │   Panel     │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Config    │  │  Execution  │  │    Share    │    │
│  │   Panel     │  │   Engine    │  │   System    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Local     │  │   Remote    │  │   Version   │    │
│  │  Storage    │  │   Sync      │  │  Control    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 코드 에디터 구현

### Monaco Editor 통합
```typescript
interface PlaygroundEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: 'typescript' | 'javascript';
  theme: 'light' | 'dark';
  readOnly?: boolean;
}

const PlaygroundEditor: React.FC<PlaygroundEditorProps> = ({
  value,
  onChange,
  language,
  theme,
  readOnly = false,
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const monacoRef = useRef<typeof monaco>();

  useEffect(() => {
    // Monaco Editor 초기화
    loader.init().then((monaco) => {
      monacoRef.current = monaco;
      
      // Robota SDK 타입 정의 등록
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        robotaTypeDefs,
        'file:///node_modules/@robota/agents/index.d.ts'
      );
      
      // 자동 완성 제공자 등록
      monaco.languages.registerCompletionItemProvider('typescript', {
        provideCompletionItems: (model, position) => {
          return {
            suggestions: getRobotaCompletions(model, position),
          };
        },
      });
      
      // 코드 액션 제공자 등록 (빠른 수정)
      monaco.languages.registerCodeActionProvider('typescript', {
        provideCodeActions: (model, range, context) => {
          return {
            actions: getRobotaQuickFixes(model, range, context),
            dispose: () => {},
          };
        },
      });
    });
  }, []);

  const handleEditorDidMount = (
    editor: monaco.editor.IStandaloneCodeEditor,
    monaco: typeof monacoType
  ) => {
    editorRef.current = editor;
    
    // 키보드 단축키 설정
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      // Ctrl/Cmd + Enter로 코드 실행
      executeCode();
    });
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Ctrl/Cmd + S로 저장
      saveProject();
    });
  };

  return (
    <div className="editor-container">
      <Editor
        height="100%"
        defaultLanguage={language}
        value={value}
        onChange={onChange}
        onMount={handleEditorDidMount}
        theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
        options={{
          readOnly,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          fontSize: 14,
          lineNumbers: 'on',
          roundedSelection: false,
          scrollbar: {
            alwaysConsumeMouseWheel: false,
          },
          cursorSmoothCaretAnimation: true,
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
        }}
      />
    </div>
  );
};
```

### 타입 정의 및 자동 완성
```typescript
// Robota SDK 타입 정의
const robotaTypeDefs = `
declare module '@robota/agents' {
  export interface AgentConfig {
    provider: 'openai' | 'anthropic' | 'google';
    model: string;
    temperature?: number;
    maxTokens?: number;
    systemMessage?: string;
  }
  
  export class Robota {
    constructor(config: AgentConfig);
    run(message: string): Promise<string>;
    runStream(message: string): AsyncGenerator<string>;
    close(): Promise<void>;
  }
  
  export interface ToolDefinition {
    name: string;
    description: string;
    parameters: any;
    handler: (params: any) => Promise<any>;
  }
  
  export class ToolRegistry {
    register(tool: ToolDefinition): void;
    get(name: string): ToolDefinition | undefined;
    list(): ToolDefinition[];
  }
}
`;

// 자동 완성 제안 생성
function getRobotaCompletions(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): monaco.languages.CompletionItem[] {
  const textUntilPosition = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  
  const suggestions: monaco.languages.CompletionItem[] = [];
  
  // Robota 클래스 인스턴스 생성 제안
  if (textUntilPosition.includes('new Robota(')) {
    suggestions.push({
      label: 'OpenAI Configuration',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText: [
        '{',
        '  provider: "openai",',
        '  model: "gpt-4",',
        '  temperature: 0.7,',
        '  maxTokens: 1000',
        '}'
      ].join('\n'),
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: 'OpenAI provider configuration template',
    });
    
    suggestions.push({
      label: 'Anthropic Configuration',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText: [
        '{',
        '  provider: "anthropic",',
        '  model: "claude-3-sonnet-20240229",',
        '  temperature: 0.7,',
        '  maxTokens: 1000',
        '}'
      ].join('\n'),
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: 'Anthropic provider configuration template',
    });
  }
  
  return suggestions;
}
```

## 템플릿 시스템

### 템플릿 구조
```typescript
interface PlaygroundTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  tags: string[];
  
  // 코드 및 설정
  files: TemplateFile[];
  dependencies: string[];
  environment: EnvironmentConfig;
  
  // 메타데이터
  author: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
  rating: number;
  
  // 학습 자료
  tutorial?: TutorialStep[];
  documentation?: string;
  examples?: ExampleUseCase[];
}

interface TemplateFile {
  name: string;
  path: string;
  content: string;
  language: 'typescript' | 'javascript' | 'json' | 'markdown';
  description?: string;
}

enum TemplateCategory {
  BASIC = 'basic',
  ADVANCED = 'advanced',
  INTEGRATION = 'integration',
  TUTORIAL = 'tutorial',
  COMMUNITY = 'community',
}

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  code?: string;
  expectedOutput?: string;
  hints?: string[];
  validation?: (output: string) => boolean;
}
```

### 기본 제공 템플릿
```typescript
const BUILTIN_TEMPLATES: PlaygroundTemplate[] = [
  {
    id: 'basic-conversation',
    name: 'Basic Conversation',
    description: 'Simple chat with AI using Robota',
    category: TemplateCategory.BASIC,
    difficulty: 'beginner',
    tags: ['chat', 'openai', 'basic'],
    files: [
      {
        name: 'main.ts',
        path: 'main.ts',
        language: 'typescript',
        content: `
import { Robota } from '@robota/agents';

async function main() {
  const agent = new Robota({
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
    systemMessage: 'You are a helpful AI assistant.'
  });

  try {
    const response = await agent.run('Hello! Can you help me?');
    console.log('AI:', response);
  } finally {
    await agent.close();
  }
}

main().catch(console.error);
        `,
        description: 'Basic conversation example with OpenAI GPT-4',
      },
    ],
    dependencies: ['@robota/agents'],
    environment: { nodeVersion: '18', timeout: 30000 },
    author: 'Robota Team',
    version: '1.0.0',
    createdAt: new Date(),
    updatedAt: new Date(),
    usageCount: 0,
    rating: 5.0,
    tutorial: [
      {
        id: 'step-1',
        title: 'Import Robota',
        description: 'First, import the Robota class from the agents package.',
        code: `import { Robota } from '@robota/agents';`,
        hints: ['Use ES6 import syntax', 'Import from @robota/agents package'],
      },
      {
        id: 'step-2',
        title: 'Create Agent Instance',
        description: 'Create a new Robota instance with OpenAI configuration.',
        code: `const agent = new Robota({
  provider: 'openai',
  model: 'gpt-4',
  temperature: 0.7
});`,
        hints: ['Specify the provider as "openai"', 'Choose an appropriate model'],
      },
    ],
  },
  
  {
    id: 'tool-calling',
    name: 'Tool Calling',
    description: 'AI agent with custom tools and function calling',
    category: TemplateCategory.ADVANCED,
    difficulty: 'intermediate',
    tags: ['tools', 'functions', 'openai'],
    files: [
      {
        name: 'main.ts',
        path: 'main.ts',
        language: 'typescript',
        content: `
import { Robota, ToolRegistry } from '@robota/agents';

// 날씨 조회 도구 정의
const weatherTool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location'
      }
    },
    required: ['location']
  },
  handler: async (params: { location: string }) => {
    // 실제로는 날씨 API를 호출하겠지만, 여기서는 시뮬레이션
    return {
      location: params.location,
      temperature: Math.floor(Math.random() * 30) + 10,
      condition: ['sunny', 'cloudy', 'rainy'][Math.floor(Math.random() * 3)]
    };
  }
};

async function main() {
  const tools = new ToolRegistry();
  tools.register(weatherTool);

  const agent = new Robota({
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
    tools: tools
  });

  try {
    const response = await agent.run(
      'What is the weather like in Seoul today?'
    );
    console.log('AI:', response);
  } finally {
    await agent.close();
  }
}

main().catch(console.error);
        `,
      },
    ],
    dependencies: ['@robota/agents'],
    environment: { nodeVersion: '18', timeout: 30000 },
    author: 'Robota Team',
    version: '1.0.0',
    createdAt: new Date(),
    updatedAt: new Date(),
    usageCount: 0,
    rating: 4.8,
  },
];
```

## 코드 실행 환경

### 웹 기반 실행 엔진
```typescript
interface ExecutionEnvironment {
  nodeVersion: string;
  timeout: number;
  maxMemory: number;
  allowedModules: string[];
}

class PlaygroundExecutor {
  private worker: Worker;
  private timeoutId: NodeJS.Timeout;
  
  constructor(private environment: ExecutionEnvironment) {
    this.worker = new Worker('/playground-worker.js');
  }
  
  async execute(code: string): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const executionId = generateId();
      
      // 타임아웃 설정
      this.timeoutId = setTimeout(() => {
        this.worker.terminate();
        reject(new Error('Execution timeout'));
      }, this.environment.timeout);
      
      // 워커 메시지 리스너
      const handleMessage = (event: MessageEvent) => {
        const { id, type, data } = event.data;
        
        if (id !== executionId) return;
        
        clearTimeout(this.timeoutId);
        this.worker.removeEventListener('message', handleMessage);
        
        if (type === 'success') {
          resolve(data);
        } else if (type === 'error') {
          reject(new Error(data.message));
        }
      };
      
      this.worker.addEventListener('message', handleMessage);
      
      // 코드 실행 요청
      this.worker.postMessage({
        id: executionId,
        type: 'execute',
        code,
        environment: this.environment,
      });
    });
  }
  
  terminate(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.worker.terminate();
  }
}

interface ExecutionResult {
  output: string[];
  errors: string[];
  logs: LogEntry[];
  duration: number;
  memoryUsage: number;
}

interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}
```

### Web Worker 구현
```typescript
// playground-worker.js
self.addEventListener('message', async (event) => {
  const { id, type, code, environment } = event.data;
  
  if (type === 'execute') {
    try {
      const result = await executeCode(code, environment);
      self.postMessage({
        id,
        type: 'success',
        data: result,
      });
    } catch (error) {
      self.postMessage({
        id,
        type: 'error',
        data: {
          message: error.message,
          stack: error.stack,
        },
      });
    }
  }
});

async function executeCode(code: string, environment: ExecutionEnvironment): Promise<ExecutionResult> {
  const startTime = performance.now();
  const output: string[] = [];
  const errors: string[] = [];
  const logs: LogEntry[] = [];
  
  // 콘솔 메서드 오버라이드
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  
  console.log = (...args) => {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    output.push(message);
    logs.push({
      level: 'info',
      message,
      timestamp: Date.now(),
    });
  };
  
  console.error = (...args) => {
    const message = args.map(arg => String(arg)).join(' ');
    errors.push(message);
    logs.push({
      level: 'error',
      message,
      timestamp: Date.now(),
    });
  };
  
  try {
    // TypeScript 컴파일 (간단한 경우)
    const jsCode = transpileTypeScript(code);
    
    // 코드 실행 (샌드박스 환경)
    const result = await executeInSandbox(jsCode, environment);
    
    const endTime = performance.now();
    
    return {
      output,
      errors,
      logs,
      duration: endTime - startTime,
      memoryUsage: getMemoryUsage(),
    };
  } finally {
    // 콘솔 복원
    Object.assign(console, originalConsole);
  }
}

function transpileTypeScript(code: string): string {
  // 간단한 TypeScript to JavaScript 변환
  // 실제로는 TypeScript 컴파일러 API 사용
  return ts.transpile(code, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
  });
}

async function executeInSandbox(code: string, environment: ExecutionEnvironment): Promise<any> {
  // 샌드박스 환경에서 코드 실행
  // require 함수 모킹
  const require = createMockRequire(environment.allowedModules);
  
  // 전역 객체 제한
  const sandbox = {
    console,
    require,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Promise,
    JSON,
    Math,
    Date,
  };
  
  // Function 생성자로 코드 실행
  const fn = new Function(
    ...Object.keys(sandbox),
    `
    "use strict";
    ${code}
    `
  );
  
  return fn(...Object.values(sandbox));
}
```

## 프로젝트 관리

### 프로젝트 저장 및 로드
```typescript
interface PlaygroundProject {
  id: string;
  name: string;
  description?: string;
  
  // 코드 파일들
  files: ProjectFile[];
  
  // 설정
  template?: string;
  dependencies: string[];
  environment: EnvironmentConfig;
  
  // 메타데이터
  owner: string;
  isPublic: boolean;
  tags: string[];
  
  // 버전 관리
  version: number;
  history: ProjectVersion[];
  
  // 실행 기록
  lastExecutedAt?: Date;
  executionCount: number;
  
  // 공유 정보
  shareId?: string;
  forkCount: number;
  starCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectFile {
  name: string;
  path: string;
  content: string;
  language: string;
}

interface ProjectVersion {
  version: number;
  changes: string;
  files: ProjectFile[];
  createdAt: Date;
}

// 프로젝트 관리 서비스
class ProjectManager {
  async saveProject(project: PlaygroundProject): Promise<void> {
    // 로컬 스토리지에 임시 저장
    localStorage.setItem(`playground:${project.id}`, JSON.stringify(project));
    
    // 로그인된 사용자인 경우 서버에 저장
    if (auth.currentUser) {
      await setDoc(
        doc(db, 'playgroundProjects', project.id),
        project
      );
    }
  }
  
  async loadProject(projectId: string): Promise<PlaygroundProject | null> {
    // 로컬 스토리지에서 먼저 확인
    const localProject = localStorage.getItem(`playground:${projectId}`);
    if (localProject) {
      return JSON.parse(localProject);
    }
    
    // 서버에서 로드
    const doc = await getDoc(doc(db, 'playgroundProjects', projectId));
    return doc.exists() ? doc.data() as PlaygroundProject : null;
  }
  
  async forkProject(sourceProjectId: string): Promise<PlaygroundProject> {
    const sourceProject = await this.loadProject(sourceProjectId);
    if (!sourceProject) {
      throw new Error('Source project not found');
    }
    
    const forkedProject: PlaygroundProject = {
      ...sourceProject,
      id: generateId(),
      name: `${sourceProject.name} (Fork)`,
      owner: auth.currentUser?.uid || 'anonymous',
      version: 1,
      history: [],
      forkCount: 0,
      starCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await this.saveProject(forkedProject);
    
    // 원본 프로젝트 fork 카운트 증가
    await updateDoc(
      doc(db, 'playgroundProjects', sourceProjectId),
      { forkCount: increment(1) }
    );
    
    return forkedProject;
  }
}
```

## 공유 및 협업 기능

### 프로젝트 공유
```typescript
interface ShareOptions {
  isPublic: boolean;
  allowComments: boolean;
  allowForks: boolean;
  expiresAt?: Date;
}

class ShareManager {
  async shareProject(
    projectId: string, 
    options: ShareOptions
  ): Promise<string> {
    const shareId = generateShareId();
    
    const shareRecord = {
      shareId,
      projectId,
      options,
      createdAt: new Date(),
      accessCount: 0,
      lastAccessedAt: null,
    };
    
    await setDoc(
      doc(db, 'projectShares', shareId),
      shareRecord
    );
    
    // 프로젝트에 shareId 업데이트
    await updateDoc(
      doc(db, 'playgroundProjects', projectId),
      { shareId, isPublic: options.isPublic }
    );
    
    return `${process.env.NEXT_PUBLIC_APP_URL}/playground/share/${shareId}`;
  }
  
  async getSharedProject(shareId: string): Promise<PlaygroundProject | null> {
    const shareDoc = await getDoc(doc(db, 'projectShares', shareId));
    
    if (!shareDoc.exists()) {
      return null;
    }
    
    const shareData = shareDoc.data();
    
    // 만료 확인
    if (shareData.options.expiresAt && new Date() > shareData.options.expiresAt) {
      return null;
    }
    
    // 접근 카운트 증가
    await updateDoc(
      doc(db, 'projectShares', shareId),
      {
        accessCount: increment(1),
        lastAccessedAt: new Date(),
      }
    );
    
    // 프로젝트 데이터 반환
    return this.projectManager.loadProject(shareData.projectId);
  }
}
```

### 실시간 협업 (선택적)
```typescript
// WebSocket 기반 실시간 협업 (향후 구현)
interface CollaborationSession {
  projectId: string;
  participants: Participant[];
  cursors: CursorPosition[];
  changes: ChangeEvent[];
}

interface Participant {
  userId: string;
  displayName: string;
  color: string;
  cursor?: CursorPosition;
}

interface CursorPosition {
  userId: string;
  line: number;
  column: number;
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

interface ChangeEvent {
  id: string;
  userId: string;
  type: 'insert' | 'delete' | 'replace';
  position: { line: number; column: number };
  content: string;
  timestamp: number;
}
``` 