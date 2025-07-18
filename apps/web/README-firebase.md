# Firebase 설정 가이드

이 가이드에서는 Robota 웹 애플리케이션에 Firebase를 설정하는 방법을 설명합니다.

## 1. Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com/)에 접속합니다.
2. "프로젝트 추가"를 클릭합니다.
3. 프로젝트 이름을 입력합니다 (예: `robota-web`).
4. Google Analytics 설정을 선택합니다 (권장).
5. 프로젝트를 생성합니다.

## 2. 웹 앱 추가

1. Firebase 프로젝트 개요에서 "웹" 아이콘을 클릭합니다.
2. 앱 닉네임을 입력합니다 (예: `robota-web`).
3. "Firebase Hosting 설정" 체크박스는 나중에 설정할 수 있으므로 건너뛸 수 있습니다.
4. "앱 등록"을 클릭합니다.

## 3. Firebase 구성 정보 복사 및 환경 변수 설정

Firebase SDK 구성 정보가 표시됩니다. 다음과 같은 형태입니다:

```javascript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdefghijk"
};
```

### 환경 변수 파일 설정

1. `apps/web` 디렉터리에서 `.env.local` 파일을 생성하거나 수정합니다:

```bash
# 예제 파일을 복사하여 시작
cp .env.example .env.local
```

2. `.env.local` 파일을 열고 Firebase 구성 정보를 입력합니다:

```env
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdefghijk

# Google Analytics (선택사항)
NEXT_PUBLIC_GA_TRACKING_ID=G-XXXXXXXXXX

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Robota SDK
```

⚠️ **주의사항**: 
- `.env.local` 파일은 gitignore에 포함되어 있어 Git에 커밋되지 않습니다
- 실제 API 키와 비밀 정보를 입력하세요
- 프로덕션 환경에서는 별도의 환경 변수 설정이 필요합니다

## 4. Authentication 설정

1. Firebase Console에서 "Authentication" 메뉴로 이동합니다.
2. "시작하기"를 클릭합니다.
3. "로그인 방법" 탭으로 이동합니다.
4. 다음 제공업체를 활성화합니다:

### 이메일/비밀번호
- "이메일/비밀번호"를 클릭합니다.
- "사용 설정"을 켭니다.
- "저장"을 클릭합니다.

### Google
- "Google"을 클릭합니다.
- "사용 설정"을 켭니다.
- 프로젝트 지원 이메일을 선택합니다.
- "저장"을 클릭합니다.

### GitHub
- "GitHub"를 클릭합니다.
- "사용 설정"을 켭니다.
- GitHub OAuth 앱을 생성해야 합니다:
  1. [GitHub Developer Settings](https://github.com/settings/developers)로 이동합니다.
  2. "New OAuth App"을 클릭합니다.
  3. 다음 정보를 입력합니다:
     - Application name: `Robota`
     - Homepage URL: `http://localhost:3000` (개발 시)
     - Authorization callback URL: Firebase에서 제공하는 콜백 URL 복사
  4. 생성된 Client ID와 Client Secret을 Firebase에 입력합니다.
- "저장"을 클릭합니다.

## 5. Firestore Database 설정

1. Firebase Console에서 "Firestore Database" 메뉴로 이동합니다.
2. "데이터베이스 만들기"를 클릭합니다.
3. "테스트 모드로 시작"을 선택합니다 (나중에 보안 규칙 설정).
4. 데이터베이스 위치를 선택합니다 (가장 가까운 지역 권장).
5. "완료"를 클릭합니다.

## 6. 환경 변수 설정

1. `apps/web` 디렉터리에 `.env.local` 파일을 생성합니다:

```bash
cd apps/web
cp .env.example .env.local
```

2. `.env.local` 파일을 열고 Firebase 구성 정보를 입력합니다:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdefghijk
```

## 7. 보안 규칙 설정 (프로덕션 준비)

### Firestore 보안 규칙
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 사용자는 자신의 문서만 읽고 쓸 수 있음
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // 프로젝트 문서 (사용자별 접근 제어)
    match /projects/{projectId} {
      allow read, write: if request.auth != null && 
        resource.data.userId == request.auth.uid;
    }
  }
}
```

### Authentication 보안 설정
1. "Authentication" → "설정" 탭으로 이동합니다.
2. "승인된 도메인"에 프로덕션 도메인을 추가합니다.
3. "사용자 작업"에서 이메일 템플릿을 사용자 정의할 수 있습니다.

## 8. 개발 서버 실행

환경 변수 설정이 완료되면 개발 서버를 시작합니다:

```bash
npm run dev
```

이제 다음 기능들을 테스트할 수 있습니다:
- 이메일/비밀번호 회원가입 및 로그인
- Google 소셜 로그인
- GitHub 소셜 로그인
- 비밀번호 재설정
- 사용자 프로필 관리

## 문제 해결

### 일반적인 오류들

1. **"Firebase: Error (auth/invalid-api-key)"**
   - API 키가 올바르지 않습니다. `.env.local` 파일의 API 키를 확인하세요.

2. **"Firebase: Error (auth/project-not-found)"**
   - 프로젝트 ID가 올바르지 않습니다. `.env.local` 파일의 프로젝트 ID를 확인하세요.

3. **소셜 로그인 실패**
   - 제공업체 설정을 확인하고, OAuth 설정이 올바른지 확인하세요.

4. **Firestore 권한 오류**
   - 보안 규칙이 테스트 모드로 설정되어 있는지 확인하거나, 적절한 보안 규칙을 설정하세요.

### 도움이 필요한 경우

- [Firebase 문서](https://firebase.google.com/docs)
- [Firebase Authentication 가이드](https://firebase.google.com/docs/auth)
- [Firestore 보안 규칙](https://firebase.google.com/docs/firestore/security/get-started) 