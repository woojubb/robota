#!/usr/bin/env node

/**
 * 패키지 디렉토리에서 임시 README 파일을 정리하는 스크립트
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES 모듈에서는 __dirname이 없으므로 현재 파일 경로에서 직접 계산
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 작업 디렉토리를 프로젝트 루트로 설정
process.chdir(path.join(__dirname, '..'));

// 패키지 경로
const packagesPath = path.resolve(__dirname, '../packages');

// 패키지 목록
const packages = ['core', 'openai', 'anthropic', 'mcp', 'tools'];

// 콘솔 출력 색상
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
};

console.log(`\n${colors.magenta}🧹 Cleaning up temporary README files${colors.reset}`);

// README 파일 정리
packages.forEach(pkg => {
    const readmePath = path.join(packagesPath, pkg, 'README.md');

    try {
        if (fs.existsSync(readmePath)) {
            fs.unlinkSync(readmePath);
            console.log(`✅ Removed: ${readmePath}`);
        }
    } catch (error) {
        console.error(`❌ Error removing ${pkg} README:`, error);
    }
});

// 완료 메시지 출력
console.log(`${colors.green}🎉 README files cleanup completed!${colors.reset}`); 