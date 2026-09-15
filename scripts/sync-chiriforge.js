const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * sync-chiriforge.js
 * 
 * Synchronizes the current working branch state to a distribution branch (e.g., 'chiriforge-dist')
 * strictly EXCLUDING the 'conductor/' directory without modifying the current workspace working directory.
 * 
 * Mechanism:
 * 1. Reads the Git Tree object of HEAD (or specified source ref).
 * 2. Filters out 'conductor' tree entries.
 * 3. Builds a clean Git Tree object using `git mktree`.
 * 4. Resolves the parent commit on the target distribution branch (e.g. 'chiriforge-dist' or 'release/main').
 * 5. Creates an atomic commit using `git commit-tree`.
 * 6. Updates the local distribution branch reference via `git update-ref`.
 * 7. Outputs verification metrics and manual git push instructions for the user.
 */

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const branchArgIdx = args.indexOf('--branch');
const targetBranch = branchArgIdx !== -1 && args[branchArgIdx + 1] ? args[branchArgIdx + 1] : 'chiriforge-dist';

function runGit(cmd, input) {
  return execSync(cmd, { cwd: rootDir, encoding: 'utf8', input }).trim();
}

function getSafeRef(ref) {
  try {
    return execSync(`git rev-parse --verify ${ref}`, { cwd: rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

console.log(`\n======================================================`);
console.log(`  Chiriforge Release Sync (Exclude 'conductor/')`);
console.log(`======================================================\n`);

// 1. Get current commit info
const currentBranch = runGit('git rev-parse --abbrev-ref HEAD');
const headSha = runGit('git rev-parse HEAD');
const shortHeadSha = headSha.substring(0, 7);
const version = pkg.version || 'unknown';

console.log(`Source Branch:      ${currentBranch} (${shortHeadSha})`);
console.log(`Target Branch:      ${targetBranch}`);
console.log(`Extension Version:  ${version}`);
console.log(`Excluded Folder:    conductor/`);

// 2. Read tree entries of HEAD
const rawTreeEntries = runGit('git ls-tree HEAD');
const lines = rawTreeEntries.split('\n').filter(Boolean);

// Exclude 'conductor'
const filteredLines = lines.filter((line) => {
  const isConductor = line.endsWith('\tconductor') || line.endsWith(' conductor');
  return !isConductor;
});

const excludedCount = lines.length - filteredLines.length;
if (excludedCount === 0) {
  console.log(`\n⚠️ Note: No 'conductor' directory was found in HEAD tree.`);
} else {
  console.log(`\n✅ Filtered out ${excludedCount} 'conductor' tree entry.`);
}

// 3. Generate clean Tree Object
const treeInput = filteredLines.join('\n') + '\n';
const cleanTreeSha = runGit('git mktree', treeInput);
console.log(`Clean Tree SHA:     ${cleanTreeSha}`);

// Verify clean tree
const treeVerification = runGit(`git ls-tree ${cleanTreeSha}`);
if (treeVerification.includes('conductor')) {
  console.error(`\n❌ Error: Verification failed. 'conductor' is still present in tree.`);
  process.exit(1);
}
console.log(`Verification:       Passed (0 instances of 'conductor')`);

if (isDryRun) {
  console.log(`\n[DRY RUN] Would update branch '${targetBranch}' with clean tree ${cleanTreeSha}. No changes made.`);
  process.exit(0);
}

// 4. Resolve Parent Commit
let parentSha = getSafeRef(`refs/heads/${targetBranch}`);
let parentDesc = `local branch '${targetBranch}'`;

if (!parentSha) {
  parentSha = getSafeRef('refs/remotes/release/main');
  parentDesc = `remote 'release/main'`;
}

if (!parentSha) {
  parentSha = getSafeRef('refs/remotes/release/develop');
  parentDesc = `remote 'release/develop'`;
}

if (!parentSha) {
  parentSha = getSafeRef('refs/heads/main');
  parentDesc = `local branch 'main'`;
}

// 5. Create Commit
const commitMessage = `release: sync v${version} (${shortHeadSha}) to chiriforge [skip conductor]\n\nSource-Commit: ${headSha}\nPackage-Version: ${version}\nExcluded: conductor/`;

let newCommitSha;
if (parentSha) {
  console.log(`Parent Commit:      ${parentSha.substring(0, 7)} (from ${parentDesc})`);
  newCommitSha = runGit(`git commit-tree ${cleanTreeSha} -p ${parentSha} -m "${commitMessage.replace(/"/g, '\\"')}"`);
} else {
  console.log(`Parent Commit:      None (Creating root commit)`);
  newCommitSha = runGit(`git commit-tree ${cleanTreeSha} -m "${commitMessage.replace(/"/g, '\\"')}"`);
}

console.log(`Created Commit:     ${newCommitSha.substring(0, 7)} (${newCommitSha})`);

// 6. Update reference
runGit(`git update-ref refs/heads/${targetBranch} ${newCommitSha}`);
console.log(`\n✅ Successfully updated local branch '${targetBranch}'.`);

// 7. Output Instructions
console.log(`\n------------------------------------------------------`);
console.log(`  NEXT STEPS (MANUAL GIT PUSH)`);
console.log(`------------------------------------------------------`);
console.log(`1. To push the FULL repository (with conductor/) to hungle-vn:`);
console.log(`   git push origin ${currentBranch}\n`);
console.log(`2. To push the PUBLIC distribution (without conductor/) to chiriforge:`);
console.log(`   git push release ${targetBranch}:main`);
console.log(`   git push release ${targetBranch}:develop\n`);
console.log(`======================================================\n`);
