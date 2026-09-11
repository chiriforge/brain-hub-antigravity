const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);

const currentVersion = pkg.version || '0.5.1';

function getNextVersion(ver) {
  // Check if version matches pattern: MAJOR.MINOR.PATCH-build-NNNN or MAJOR.MINOR.PATCH-bNNNN
  const match = ver.match(/^(\d+\.\d+\.\d+)(?:-build-|-b)?(\d+)?$/);
  if (match) {
    const base = match[1];
    const buildNum = match[2] ? parseInt(match[2], 10) + 1 : 1;
    const padded = String(buildNum).padStart(4, '0');
    return `${base}-build-${padded}`;
  }

  // If simple semver 0.5.1
  return `${ver}-build-0001`;
}

// Allow explicit version from command line: node scripts/release.js 0.5.1
const customArg = process.argv[2];
let targetVersion;

if (customArg && !customArg.startsWith('--')) {
  // If user passed e.g. 0.5.1.0001, convert to valid semver 0.5.1-build-0001
  const dot4Match = customArg.match(/^(\d+\.\d+\.\d+)\.(\d+)$/);
  if (dot4Match) {
    const padded = String(parseInt(dot4Match[2], 10)).padStart(4, '0');
    targetVersion = `${dot4Match[1]}-build-${padded}`;
  } else {
    targetVersion = customArg;
  }
} else {
  targetVersion = getNextVersion(currentVersion);
}

console.log(`\n📦 Packaging ${pkg.displayName || 'Brain Hub for Antigravity'} Release`);
console.log(`-----------------------------------------------`);
console.log(`Current Version: ${currentVersion}`);
console.log(`Target Version:  ${targetVersion}`);

// Update package.json
pkg.version = targetVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`\n✅ Updated package.json version to: ${targetVersion}`);

try {
  console.log(`\n🚀 Compiling TypeScript...`);
  execSync('npm run compile', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });

  console.log(`\n🚀 Building extension with esbuild...`);
  execSync('npm run build', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });

  console.log(`\n📦 Packaging VSIX with @vscode/vsce...`);
  execSync('npx @vscode/vsce package --no-dependencies', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });

  const vsixName = `${pkg.name || 'brain-hub-antigravity'}-${targetVersion}.vsix`;
  console.log(`\n🎉 Release build successful!`);
  console.log(`👉 Output VSIX: ${vsixName}`);
} catch (err) {
  console.error(`\n❌ Release build failed:`, err);
  process.exit(1);
}
