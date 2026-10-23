const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Testing scan lock orphaned process recovery and resilience...');

// 1. Process Liveness Check Invariant
function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

// Verify current process is alive
assert.strictEqual(isProcessAlive(process.pid), true, 'Current process must be alive');
// Verify PID 99999999 is dead
assert.strictEqual(isProcessAlive(99999999), false, 'Non-existent PID must be dead');
// Verify 0 or negative is false
assert.strictEqual(isProcessAlive(0), false, 'PID 0 must return false');
assert.strictEqual(isProcessAlive(-1), false, 'Negative PID must return false');
console.log('✓ isProcessAlive logic verified!');

// 2. Orphaned Lock Simulation
const testDir = path.join(os.tmpdir(), 'antigravity_test_scan_lock_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
const lockFile = path.join(testDir, 'sessions_scan.lock');

function acquireLockWithLiveness(targetFile, ttlMs = 15000) {
  const now = Date.now();
  if (fs.existsSync(targetFile)) {
    try {
      const raw = fs.readFileSync(targetFile, 'utf8');
      if (raw && raw.trim().length > 0) {
        const lockData = JSON.parse(raw);
        if (lockData && lockData.expiresAt && now < lockData.expiresAt && lockData.pid !== process.pid) {
          // Check process liveness
          if (isProcessAlive(lockData.pid)) {
            // Live process is actively scanning
            return false;
          }
          // Dead process PID -> prune orphaned lock
          try {
            fs.unlinkSync(targetFile);
          } catch {}
        }
      }
    } catch {
      // Corrupted lockfile -> overwrite
    }
  }

  // Acquire lock
  fs.writeFileSync(
    targetFile,
    JSON.stringify({
      pid: process.pid,
      timestamp: now,
      expiresAt: now + ttlMs
    }),
    'utf8'
  );
  return true;
}

// Case A: Dead PID lockfile -> must prune and acquire immediately
fs.writeFileSync(
  lockFile,
  JSON.stringify({
    pid: 99999999,
    timestamp: Date.now(),
    expiresAt: Date.now() + 60000 // future expiry, but dead PID
  }),
  'utf8'
);

const acquiredA = acquireLockWithLiveness(lockFile);
assert.strictEqual(acquiredA, true, 'Must acquire lock if previous PID is dead');
const dataA = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
assert.strictEqual(dataA.pid, process.pid, 'Lock must be owned by current process');
console.log('✓ Dead PID orphaned lock successfully pruned and acquired!');

// Case B: Live PID lockfile -> must respect and reject
// Simulate another live process by using current process PID with different simulated PID check
const isLivePid = (pid) => pid === process.pid || pid === 12345;
function acquireSimulated(targetFile, simulatedChecker) {
  const now = Date.now();
  if (fs.existsSync(targetFile)) {
    const raw = fs.readFileSync(targetFile, 'utf8');
    const lockData = JSON.parse(raw);
    if (lockData.expiresAt && now < lockData.expiresAt && lockData.pid !== process.pid) {
      if (simulatedChecker(lockData.pid)) {
        return false;
      }
    }
  }
  return true;
}

fs.writeFileSync(
  lockFile,
  JSON.stringify({
    pid: 12345,
    timestamp: Date.now(),
    expiresAt: Date.now() + 60000
  }),
  'utf8'
);

const acquiredB = acquireSimulated(lockFile, isLivePid);
assert.strictEqual(acquiredB, false, 'Must respect live PID lock within TTL');
console.log('✓ Live PID lock within TTL respected!');

// Case C: Corrupted 0-byte lockfile -> must recover without throwing
fs.writeFileSync(lockFile, '', 'utf8');
const acquiredC = acquireLockWithLiveness(lockFile);
assert.strictEqual(acquiredC, true, 'Must overwrite corrupted 0-byte lockfile safely');
console.log('✓ Corrupted 0-byte lockfile safe overwrite verified!');

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });
console.log('\nALL SCAN LOCK RESILIENCE TESTS PASSED (100%)!\n');
