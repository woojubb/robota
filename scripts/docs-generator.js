/**
 * TypeDoc을 사용하여 TypeScript 코드에서 마크다운 API 문서를 생성하는 스크립트
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { globSync } from 'glob';
import { marked } from 'marked';

// HTML 템플릿
const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>Robota API 문서</title>
  <meta name="description" content="Robota API 문서">
  <link rel="stylesheet" href="/robota/style.css">
</head>
<body>
  <div id="content">
    {{CONTENT}}
  </div>
  <script>
    // 페이지가 로드되면 Docsify로 리다이렉션
    window.addEventListener('DOMContentLoaded', function() {
      // 현재 경로에서 .html 확장자 제거
      const currentPath = window.location.pathname;
      if (currentPath.endsWith('.html')) {
        // history 모드를 위한 리다이렉션
        const newPath = currentPath.replace('.html', '');
        window.location.replace(newPath);
      }
    });
  </script>
</body>
</html>`;

// 디렉토리 경로 설정
const ROOT_DIR = process.cwd(); // 현재 스크립트가 루트 디렉토리에서 실행되므로 process.cwd()만 사용
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const OUTPUT_DIR = path.join(DOCS_DIR, 'api-reference');

// API 카테고리
const API_CATEGORIES = [
    { name: 'Core', pattern: 'packages/core/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'core/src/index.ts') },
    { name: 'OpenAI', pattern: 'packages/openai/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'openai/src/index.ts') },
    { name: 'Anthropic', pattern: 'packages/anthropic/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'anthropic/src/index.ts') },
    { name: 'Google', pattern: 'packages/google/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'google/src/index.ts') },
    { name: 'MCP', pattern: 'packages/mcp/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'mcp/src/index.ts') },
    { name: 'Tools', pattern: 'packages/tools/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'tools/src/index.ts') },
];

// API 문서 메인 파일 생성
function generateApiIndexPage() {
    console.log(`루트 디렉토리: ${ROOT_DIR}`);
    console.log(`문서 디렉토리: ${DOCS_DIR}`);
    console.log(`출력 디렉토리: ${OUTPUT_DIR}`);

    const content = `# Robota API 참조

Robota 라이브러리의 API 문서입니다. 각 클래스, 함수, 타입에 대한 자세한 설명을 확인할 수 있습니다.

## 패키지

${API_CATEGORIES.map(category => `- [${category.name}](${category.name.toLowerCase()}/index.md)`).join('\n')}
`;

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const indexPath = path.resolve(OUTPUT_DIR, 'README.md');
    fs.writeFileSync(indexPath, content);
    console.log(`✅ API 인덱스 페이지 생성 완료: ${indexPath}`);
}

// TypeDoc을 사용하여 API 문서 생성
async function generateDocsForCategory(category) {
    const { name, pattern, entryPoint } = category;

    // 파일 존재 확인
    if (!fs.existsSync(entryPoint)) {
        console.error(`⚠️ 엔트리 포인트가 존재하지 않습니다: ${entryPoint}`);
        return 0;
    }

    // 파일 찾기
    const files = globSync(path.join(ROOT_DIR, pattern), {
        ignore: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']
    });

    if (files.length === 0) {
        console.log(`⚠️ ${name} 카테고리에 해당하는 파일을 찾을 수 없습니다. 패턴: ${pattern}`);
        return 0;
    }

    console.log(`🔍 ${name} 카테고리에서 ${files.length}개 파일 발견`);

    // 카테고리 디렉토리 생성
    const categoryDir = path.join(OUTPUT_DIR, name.toLowerCase());
    if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
    }

    // TypeDoc 명령어 실행
    try {
        // 패키지 경로에서 tsconfig.json 찾기
        const packageDir = path.dirname(path.dirname(entryPoint)); // src의 상위 디렉토리
        const tsconfigPath = path.join(packageDir, 'tsconfig.json');

        if (!fs.existsSync(tsconfigPath)) {
            console.error(`⚠️ tsconfig.json 파일을 찾을 수 없습니다: ${tsconfigPath}`);
            return 0;
        }

        const command = `npx typedoc --plugin typedoc-plugin-markdown --out ${categoryDir} --entryPoints ${entryPoint} --tsconfig ${tsconfigPath} --name "${name} API" --excludePrivate --excludeProtected --skipErrorChecking`;

        console.log(`실행 명령어: ${command}`);
        execSync(command, { stdio: 'inherit' });

        // 링크 경로 수정
        fixDocumentLinks(categoryDir, name.toLowerCase());

        console.log(`✅ ${name} 카테고리 API 문서 생성 완료: ${categoryDir}`);
        return files.length;
    } catch (error) {
        console.error(`⚠️ ${name} 카테고리 API 문서 생성 중 오류 발생:`, error);
        return 0;
    }
}

// API 문서 내 링크 경로 수정 (상대 경로 -> 절대 경로)
function fixDocumentLinks(categoryDir, categoryName) {
    console.log(`🔧 ${categoryName} 카테고리 문서 내 링크 경로 수정 중...`);

    // 해당 카테고리의 모든 마크다운 파일 찾기
    const mdFiles = globSync(path.join(categoryDir, '**/*.md'));

    for (const mdFile of mdFiles) {
        try {
            // 현재 파일의 상대 경로 (docs 디렉토리부터)
            const relativePath = path.relative(DOCS_DIR, mdFile);
            // 현재 파일이 속한 디렉토리 (예: api-reference/core/classes)
            const fileDir = path.dirname(relativePath);
            // 현재 파일명 (예: FunctionRegistry.md)
            const fileName = path.basename(mdFile);
            // 확장자 없는 파일명 (예: FunctionRegistry)
            const fileNameWithoutExt = fileName.replace('.md', '');

            // 파일 내용 읽기
            let content = fs.readFileSync(mdFile, 'utf-8');

            // 다양한 링크 패턴 처리
            // 1. README.md -> 디렉토리 인덱스로
            content = content.replace(/\]\(README\.md(#[^)]+)?\)/g, (match, section) => {
                return section ? `](../${section})` : `](../)`;
            });

            // 2. ../README.md -> 상위 디렉토리 인덱스로
            content = content.replace(/\]\(\.\.\/README\.md(#[^)]+)?\)/g, (match, section) => {
                return section ? `](../../${section})` : `](../../)`;
            });

            // 3. 상대 경로 처리 (예: ../interfaces/XXX.md -> ../interfaces/XXX)
            content = content.replace(/\]\(([^)]+)\.md(#[^)]*)?\)/g, (match, path, anchor) => {
                return `](${path}${anchor || ''})`;
            });

            // 파일 저장
            fs.writeFileSync(mdFile, content);
        } catch (error) {
            console.error(`⚠️ ${mdFile} 파일 링크 수정 중 오류 발생:`, error);
        }
    }

    console.log(`✅ ${categoryName} 카테고리 문서 내 링크 경로 수정 완료`);
}

async function main() {
    console.log('🔍 API 문서 생성 작업 시작...');

    // API 인덱스 페이지 생성
    generateApiIndexPage();

    // 각 카테고리별 문서 생성
    let totalDocs = 0;
    for (const category of API_CATEGORIES) {
        const count = await generateDocsForCategory(category);
        totalDocs += count;
    }

    console.log(`🎉 API 문서 생성 완료! 총 ${totalDocs}개 파일에 대한 문서가 생성되었습니다.`);
}

// 메인 함수 실행
main().catch(error => {
    console.error('❌ API 문서 생성 중 오류 발생:', error);
    process.exit(1);
}); 