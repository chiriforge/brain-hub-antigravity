const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getEnvToken() {
  if (process.env.OVSX_PAT) {
    return process.env.OVSX_PAT.trim();
  }

  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('OVSX_PAT=')) {
        return trimmed.replace(/^OVSX_PAT=/, '').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return null;
}

const token = getEnvToken();
if (!token) {
  console.error('❌ Error: OVSX_PAT token not found in environment or .env file.');
  console.error('👉 Please set OVSX_PAT in .env (e.g. OVSX_PAT=ovsxat_...)');
  process.exit(1);
}

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const vsixName = `${pkg.name || 'brain-hub-antigravity'}-${version}.vsix`;
const vsixPath = path.resolve(__dirname, '..', vsixName);

if (!fs.existsSync(vsixPath)) {
  console.error(`❌ Error: VSIX package file not found: ${vsixName}`);
  console.error(`👉 Run "npm run package" or "npm run release" first to build the .vsix package.`);
  process.exit(1);
}

console.log(`\n🚀 Publishing ${vsixName} to Open VSX Registry...`);
try {
  execSync(`npx -y ovsx publish "${vsixPath}" -p "${token}"`, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..')
  });
  console.log(`\n✅ Published ${pkg.name} v${version} to Open VSX successfully!\n`);
} catch (err) {
  console.error(`\n❌ Publishing to Open VSX failed:`, err);
  process.exit(1);
}
