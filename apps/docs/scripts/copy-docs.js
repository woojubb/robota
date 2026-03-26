import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(__dirname, '../../../');
const docsPath = path.join(rootPath, 'content');
const packagesPath = path.join(rootPath, 'packages');
const tempDir = path.join(rootPath, 'apps/docs/.temp');

// Initialize temporary directory
console.log('Starting document copy...');
fs.removeSync(tempDir);
fs.ensureDirSync(tempDir);

// Copy main docs directory contents to .temp
console.log('Copying main docs directory...');
fs.copySync(docsPath, tempDir, {
  filter: (src) => {
    // Exclude unnecessary files
    if (src.includes('node_modules')) return false;
    if (path.basename(src).startsWith('.')) return false;
    // Exclude directories that bloat the build (source preserved, excluded from VitePress)
    const relPath = path.relative(docsPath, src);
    if (relPath.startsWith('v2.0.0')) return false;
    if (relPath.startsWith('api-reference')) return false;
    return true;
  },
});

// Copy package-specific docs
console.log('Copying package-specific docs...');
const packagesDir = fs.readdirSync(packagesPath);

packagesDir.forEach((packageName) => {
  const packagePath = path.join(packagesPath, packageName);
  const packageDocsPath = path.join(packagePath, 'docs');

  if (fs.existsSync(packageDocsPath) && fs.statSync(packageDocsPath).isDirectory()) {
    const targetPackageDocsPath = path.join(tempDir, 'packages', packageName, 'docs');
    console.log(`  Copying ${packageName} docs...`);

    fs.ensureDirSync(targetPackageDocsPath);
    fs.copySync(packageDocsPath, targetPackageDocsPath, {
      filter: (src) => {
        return !src.includes('node_modules') && !path.basename(src).startsWith('.');
      },
    });
  }
});

// Create package index if it doesn't exist
const packagesIndexPath = path.join(tempDir, 'packages', 'README.md');
if (!fs.existsSync(packagesIndexPath)) {
  console.log('Creating packages index...');
  fs.ensureDirSync(path.dirname(packagesIndexPath));

  let packagesIndex = '# Packages\n\n';
  packagesIndex += 'Documentation for individual packages in the Robota SDK.\n\n';

  packagesDir.forEach((packageName) => {
    const packageDocsPath = path.join(packagesPath, packageName, 'docs');
    if (fs.existsSync(packageDocsPath)) {
      packagesIndex += `- [${packageName}](./${packageName}/README.md)\n`;
    }
  });

  fs.writeFileSync(packagesIndexPath, packagesIndex);
}

console.log('Document copy completed!');
