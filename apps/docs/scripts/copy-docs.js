import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(__dirname, '../../../');
const docsPath = path.join(rootPath, 'docs');
const tempDir = path.join(rootPath, 'apps/docs/.temp');

// 임시 디렉토리 초기화
console.log('문서 복사 시작...');
fs.removeSync(tempDir);
fs.ensureDirSync(tempDir);

// docs 디렉토리 내용을 .temp로 복사
fs.copySync(docsPath, tempDir, {
    filter: (src) => {
        // .git 등 불필요한 파일은 제외
        return !src.includes('node_modules') && !path.basename(src).startsWith('.');
    }
});

// README.md 파일을 index.md로 변환
const findAndRenameReadme = (dir) => {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
            findAndRenameReadme(fullPath);
        } else if (file.name === 'README.md') {
            const newPath = path.join(dir, 'index.md');
            fs.renameSync(fullPath, newPath);
            console.log(`✓ README.md를 index.md로 변환: ${fullPath} -> ${newPath}`);
        }
    }
};

findAndRenameReadme(tempDir);
console.log('문서 복사 완료!'); 