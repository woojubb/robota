# UI/UX 설계 및 페이지 구조

## 디자인 시스템

### 컬러 팔레트
```css
/* Primary Colors */
--primary-50: #f0f9ff;
--primary-100: #e0f2fe;
--primary-500: #0ea5e9;
--primary-600: #0284c7;
--primary-900: #0c4a6e;

/* Secondary Colors */
--secondary-50: #fafaf9;
--secondary-100: #f5f5f4;
--secondary-500: #78716c;
--secondary-600: #57534e;
--secondary-900: #1c1917;

/* Semantic Colors */
--success: #22c55e;
--warning: #f59e0b;
--error: #ef4444;
--info: #3b82f6;
```

### 타이포그래피
```css
/* Font Families */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;

/* Font Sizes */
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
--text-4xl: 2.25rem;   /* 36px */
```

### 간격 및 레이아웃
```css
/* Spacing Scale */
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-4: 1rem;     /* 16px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
--space-12: 3rem;    /* 48px */
--space-16: 4rem;    /* 64px */

/* Border Radius */
--radius-sm: 0.125rem;  /* 2px */
--radius-md: 0.375rem;  /* 6px */
--radius-lg: 0.5rem;    /* 8px */
--radius-xl: 0.75rem;   /* 12px */
```

## 사이트 구조 및 네비게이션

### 메인 네비게이션
```
Header Navigation:
├── Logo (Robota)
├── Products
│   ├── SDK
│   ├── API
│   └── Playground
├── Pricing
├── Docs
├── Community
└── User Menu
    ├── Dashboard
    ├── Settings
    └── Logout
```

### 사이트맵
```
Robota SaaS Website
├── 🏠 Home (/)
├── 🚀 Getting Started (/getting-started)
├── 💻 Playground (/playground)
├── 📚 Documentation (/docs)
│   ├── API Reference
│   ├── SDK Guide
│   └── Tutorials
├── 💰 Pricing (/pricing)
├── 👥 Community (/community)
├── 🔐 Authentication
│   ├── Login (/login)
│   └── Signup (/signup)
└── 📊 Dashboard (/dashboard)
    ├── Overview
    ├── Projects
    ├── API Keys
    ├── Usage & Billing
    └── Settings
```

## 주요 페이지 설계

### 1. 홈페이지 (/)

#### 레이아웃 구조
```
┌─────────────────────────────────────┐
│              Header                 │
├─────────────────────────────────────┤
│              Hero Section           │
│     "Build AI Agents Faster"       │
│   [Try Playground] [Get Started]   │
├─────────────────────────────────────┤
│           Features Section          │
│  [Code Gen] [Multi-Provider] [API] │
├─────────────────────────────────────┤
│        Interactive Demo             │
│       Live Code Examples           │
├─────────────────────────────────────┤
│         Testimonials               │
├─────────────────────────────────────┤
│           Pricing CTA              │
├─────────────────────────────────────┤
│              Footer                │
└─────────────────────────────────────┘
```

#### Hero Section 컴포넌트
- **메인 헤드라인**: "Build AI Agents Faster with Robota"
- **서브 헤드라인**: "Multi-provider AI SDK with built-in tools, templates, and team collaboration"
- **CTA 버튼**: 
  - Primary: "Try Playground" → `/playground`
  - Secondary: "View Documentation" → `/docs`
- **시각적 요소**: 
  - 애니메이션 코드 에디터 미리보기
  - 실시간 타이핑 효과로 코드 생성 시연

### 2. Playground (/playground)

#### 레이아웃 구조
```
┌─────────────────────────────────────────────────────────┐
│                    Header Bar                           │
│  [Templates] [Save] [Share] [Run]     [User] [Settings] │
├─────────────────────────────────────────────────────────┤
│ Sidebar  │           Code Editor            │  Output   │
│          │                                  │  Panel    │
│ Template │  Monaco Editor                   │           │
│ Library  │  - TypeScript Support            │  Console  │
│          │  - Auto-completion               │  Preview  │
│ Config   │  - Error Highlighting            │  Logs     │
│ Panel    │  - Multi-file Support            │           │
│          │                                  │           │
├─────────────────────────────────────────────────────────┤
│                   Status Bar                            │
│  Line: 45, Col: 12    Language: TypeScript    [Ready]  │
└─────────────────────────────────────────────────────────┘
```

#### 주요 기능
- **템플릿 선택기**: 
  - Basic Conversation
  - Tool Calling
  - Multi-Provider Setup
  - Team Collaboration
  - Custom Template Upload
- **코드 에디터**:
  - VS Code 기반 Monaco Editor
  - 실시간 타입 체크
  - 자동 완성 및 인텔리센스
  - 다중 파일 지원
- **실행 환경**:
  - 웹 기반 Node.js 런타임
  - 안전한 샌드박스 환경
  - 실시간 로그 출력

### 3. 대시보드 (/dashboard)

#### 레이아웃 구조
```
┌─────────────────────────────────────────────────────────┐
│                  Dashboard Header                       │
│  Welcome back, {userName}           [Notifications] [?] │
├─────┬───────────────────────────────────────────────────┤
│Side │                Main Content                       │
│Nav  │  ┌─────────────────────────────────────────────┐  │
│     │  │            Quick Stats                      │  │
│Over │  │  [API Calls] [Projects] [Usage] [Billing]  │  │
│view │  └─────────────────────────────────────────────┘  │
│     │  ┌─────────────────────────────────────────────┐  │
│Pro  │  │         Recent Projects                     │  │
│ject │  │  Project 1    Last: 2 hours ago    [Open]  │  │
│     │  │  Project 2    Last: 1 day ago      [Open]  │  │
│API  │  └─────────────────────────────────────────────┘  │
│Keys │  ┌─────────────────────────────────────────────┐  │
│     │  │           Usage Chart                       │  │
│Bill │  │    [Monthly API Usage Visualization]       │  │
│ing  │  └─────────────────────────────────────────────┘  │
│     │                                                  │
│Set  │                                                  │
│ting │                                                  │
└─────┴───────────────────────────────────────────────────┘
```

#### 대시보드 섹션들

##### Overview
- **사용량 통계**: API 호출 수, 활성 프로젝트, 월간 사용량
- **최근 활동**: 프로젝트 생성, API 키 사용, 설정 변경
- **Quick Actions**: 새 프로젝트, API 키 생성, 문서 보기

##### Projects
- **프로젝트 목록**: 그리드/리스트 뷰 토글
- **필터링**: 날짜, 템플릿 타입, 상태별
- **정렬**: 생성일, 수정일, 이름순
- **프로젝트 카드**: 
  - 썸네일 이미지
  - 프로젝트 이름 및 설명
  - 마지막 수정 시간
  - 사용된 템플릿 정보

##### API Keys
- **키 관리**: 생성, 삭제, 비활성화
- **권한 설정**: Read/Write 권한 세분화
- **사용량 모니터링**: 키별 호출 통계
- **보안 설정**: IP 제한, 도메인 제한

### 4. 인증 페이지

#### 로그인 페이지 (/login)
```
┌─────────────────────────────────────┐
│              Center Card            │
│                                     │
│         🤖 Robota Logo              │
│                                     │
│      Welcome back                   │
│   Sign in to your account          │
│                                     │
│  ┌─ Continue with GitHub ─────────┐ │
│  │     [GitHub Icon] GitHub       │ │
│  └─────────────────────────────────┘ │
│                                     │
│  ┌─ Continue with Google ─────────┐ │
│  │     [Google Icon] Google       │ │
│  └─────────────────────────────────┘ │
│                                     │
│          ── or ──                   │
│                                     │
│  Email: [_________________]         │
│  Password: [_________________]      │
│                                     │
│  [x] Remember me    Forgot password?│
│                                     │
│       [Sign In Button]             │
│                                     │
│    Don't have an account?          │
│         Sign up here               │
└─────────────────────────────────────┘
```

#### 회원가입 페이지 (/signup)
- 동일한 OAuth 제공업체 (GitHub, Google)
- 이메일 회원가입 폼
- 약관 동의 체크박스
- 이메일 인증 프로세스

## 컴포넌트 라이브러리

### 기본 컴포넌트
```typescript
// Button 컴포넌트
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'outline' | 'ghost';
  size: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

// Card 컴포넌트
interface CardProps {
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

// Input 컴포넌트
interface InputProps {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  type: 'text' | 'email' | 'password' | 'number';
}
```

### 복합 컴포넌트
```typescript
// CodeEditor 컴포넌트
interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: 'typescript' | 'javascript' | 'json';
  theme: 'light' | 'dark';
  readOnly?: boolean;
  minimap?: boolean;
}

// StatsCard 컴포넌트
interface StatsCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    type: 'increase' | 'decrease';
  };
  icon: React.ComponentType;
}

// ProjectCard 컴포넌트
interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    description: string;
    template: string;
    updatedAt: Date;
    thumbnail?: string;
  };
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}
```

## 반응형 디자인

### 브레이크포인트
```css
/* Mobile First Approach */
--screen-sm: 640px;   /* Small devices */
--screen-md: 768px;   /* Medium devices */
--screen-lg: 1024px;  /* Large devices */
--screen-xl: 1280px;  /* Extra large devices */
--screen-2xl: 1536px; /* 2X large devices */
```

### 반응형 레이아웃
```typescript
// 모바일 (< 768px)
- 단일 컬럼 레이아웃
- 햄버거 메뉴
- 풀스크린 모달
- 스택 네비게이션

// 태블릿 (768px - 1024px)
- 2컬럼 레이아웃
- 사이드바 접기/펼치기
- 적응형 그리드

// 데스크톱 (> 1024px)
- 3컬럼 레이아웃
- 고정 사이드바
- 멀티패널 뷰
```

## 접근성 (A11y) 가이드라인

### WCAG 2.1 AA 준수
- **키보드 네비게이션**: 모든 인터랙티브 요소 접근 가능
- **스크린 리더**: 의미 있는 aria-label 및 alt 텍스트
- **컬러 대비**: 최소 4.5:1 대비율 유지
- **포커스 관리**: 명확한 포커스 표시

### 접근성 컴포넌트
```typescript
// AccessibleButton
interface AccessibleButtonProps extends ButtonProps {
  ariaLabel?: string;
  ariaDescribedBy?: string;
  tabIndex?: number;
}

// ScreenReaderOnly
const ScreenReaderOnly: React.FC<{children: React.ReactNode}> = ({children}) => (
  <span className="sr-only">{children}</span>
);
```

## 애니메이션 및 인터랙션

### 마이크로 인터랙션
- **버튼 호버**: 부드러운 색상 전환 (200ms)
- **카드 호버**: 그림자 증가 및 약간의 상승 효과
- **로딩 상태**: 스켈레톤 UI 및 스피너
- **페이지 전환**: 부드러운 슬라이드 애니메이션

### Framer Motion 설정
```typescript
// 페이지 전환 애니메이션
const pageVariants = {
  initial: { opacity: 0, x: -200 },
  in: { opacity: 1, x: 0 },
  out: { opacity: 0, x: 200 }
};

const pageTransition = {
  type: "tween",
  ease: "anticipate",
  duration: 0.5
};

// 컴포넌트 애니메이션
const cardVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 }
};
```

## 다크 모드 지원

### 테마 전환
```typescript
// 테마 컨텍스트
interface ThemeContextType {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

// CSS 변수 기반 테마
:root {
  --background: #ffffff;
  --foreground: #000000;
}

[data-theme="dark"] {
  --background: #000000;
  --foreground: #ffffff;
}
```

### 시스템 테마 감지
```typescript
// 시스템 다크 모드 감지
const useSystemTheme = () => {
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);
  
  return systemTheme;
};
``` 