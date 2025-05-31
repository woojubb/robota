#!/usr/bin/env node

/**
 * 문서 배포 준비 스크립트
 * GitHub Actions와 로컬에서 동일하게 사용
 * 실제 배포는 GitHub Actions에서 별도로 수행
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = process.cwd();
const DOCS_DIR = path.join(ROOT_DIR, 'apps/docs');

function log(message) {
    console.log(`[PREPARE] ${message}`);
}

function executeCommand(command, options = {}) {
    log(`Executing: ${command}`);
    try {
        execSync(command, {
            stdio: 'inherit',
            cwd: options.cwd || ROOT_DIR,
            ...options
        });
    } catch (error) {
        console.error(`❌ Command failed: ${command}`);
        throw error;
    }
}

async function main() {
    log('🚀 Starting documentation build preparation...');

    // 1. 의존성 설치
    log('📦 Installing dependencies...');
    executeCommand('pnpm install');

    // 2. TypeDoc 변환 (TypeScript → Markdown)
    log('📚 Converting TypeScript to API documentation...');
    executeCommand('pnpm typedoc:convert');

    // 3. 문서 빌드
    log('🔨 Building documentation...');
    executeCommand('pnpm run build', { cwd: DOCS_DIR });

    // 4. .nojekyll 파일 추가 (GitHub Pages용)
    log('📄 Adding .nojekyll file...');
    const nojekyllPath = path.join(DOCS_DIR, '.vitepress/dist/.nojekyll');
    fs.writeFileSync(nojekyllPath, '');

    // 5. 빌드 결과 확인
    log('✅ Build preparation completed successfully!');
    const distDir = path.join(DOCS_DIR, '.vitepress/dist');
    const files = fs.readdirSync(distDir);
    log(`📁 Generated files: ${files.join(', ')}`);

    // 6. API 문서 파일 확인
    const apiCoreFile = path.join(distDir, 'api-reference/core/index.html');
    if (fs.existsSync(apiCoreFile)) {
        const stats = fs.statSync(apiCoreFile);
        log(`✅ API Core documentation: ${Math.round(stats.size / 1024)}KB`);
    } else {
        log('⚠️ API Core documentation not found');
    }

    log('🎉 Documentation build preparation completed!');
    log('📤 Ready for deployment to GitHub Pages');
}

// 스크립트 실행
main().catch(error => {
    console.error('❌ Documentation preparation failed:', error);
    process.exit(1);
}); 