import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const distDir = path.resolve(__dirname, '../.vitepress/dist');

console.log('📁 Copying public files to build output...');

if (fs.existsSync(publicDir)) {
    const files = fs.readdirSync(publicDir);

    for (const file of files) {
        const srcPath = path.join(publicDir, file);
        const destPath = path.join(distDir, file);

        if (fs.statSync(srcPath).isFile()) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`✅ Copied: ${file}`);
        }
    }
    console.log('✅ Public files copied successfully!');
} else {
    console.log('⚠️  Public directory not found:', publicDir);
} 