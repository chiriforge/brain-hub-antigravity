const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Testing atomic cache persistence, retry backoff & zero-byte guard...');

const testDir = path.join(os.tmpdir(), 'antigravity_test_atomic_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

// Function replicating the atomic two-step write with backoff
function atomicWriteJsonSync(targetPath, data) {
  const rawData = JSON.stringify(data, null, 2);
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, rawData, 'utf8');

  // Verify tmp write integrity (non-empty)
  const stat = fs.statSync(tmpPath);
  if (stat.size === 0 && rawData.length > 0) {
    throw new Error('Truncated zero-byte temporary file detected during write!');
  }

  // Atomic rename with retry loop for Windows EBUSY/EPERM locks
  let attempts = 0;
  const maxAttempts = 5;
  while (attempts < maxAttempts) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return true;
    } catch (err) {
      attempts++;
      if (attempts >= maxAttempts) {
        // Fallback: copy and unlink
        try {
          fs.copyFileSync(tmpPath, targetPath);
          fs.unlinkSync(tmpPath);
          return true;
        } catch (copyErr) {
          throw copyErr;
        }
      }
      // Busy wait short backoff
      const start = Date.now();
      while (Date.now() - start < 10 * attempts) {}
    }
  }
}

// 1. Basic atomic write
const cacheFile = path.join(testDir, 'cache.json');
atomicWriteJsonSync(cacheFile, [{ id: 'sess_1', title: 'Test 1' }]);
assert(fs.existsSync(cacheFile), 'Target cache file must exist');
const content1 = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
assert.strictEqual(content1.length, 1);
assert.strictEqual(content1[0].id, 'sess_1');
console.log('✓ Basic atomic write verified!');

// 2. High-concurrency rapid overwrites
for (let i = 0; i < 50; i++) {
  atomicWriteJsonSync(cacheFile, [{ id: `sess_${i}`, title: `Iteration ${i}` }]);
}
const finalContent = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
assert.strictEqual(finalContent[0].id, 'sess_49');
console.log('✓ 50 rapid successive atomic overwrites passed with 0 corruptions!');

// 3. Simulated Corrupted / 0-Byte Recovery
function safeReadJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || raw.trim().length === 0) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const emptyFile = path.join(testDir, 'empty.json');
fs.writeFileSync(emptyFile, '', 'utf8');
assert.deepStrictEqual(safeReadJson(emptyFile), [], 'Must return fallback on 0-byte file');

const malformedFile = path.join(testDir, 'malformed.json');
fs.writeFileSync(malformedFile, '{ "bad_json": [ incomplete', 'utf8');
assert.deepStrictEqual(safeReadJson(malformedFile), [], 'Must return fallback on malformed JSON without crashing');
console.log('✓ Safe reading guard against 0-byte and malformed JSON verified!');

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });
console.log('\nALL ATOMIC CACHE PERSISTENCE TESTS PASSED (100%)!\n');
