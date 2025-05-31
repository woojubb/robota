import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(__dirname, '../../../');
const docsPath = path.join(rootPath, 'docs');
const tempDir = path.join(rootPath, 'apps/docs/.temp');

// Initialize temporary directory
console.log('Starting document copy...');
fs.removeSync(tempDir);
fs.ensureDirSync(tempDir);

// Copy docs directory contents to .temp
fs.copySync(docsPath, tempDir, {
    filter: (src) => {
        // Exclude unnecessary files like .git
        return !src.includes('node_modules') && !path.basename(src).startsWith('.');
    }
});

console.log('Document copy completed!'); 