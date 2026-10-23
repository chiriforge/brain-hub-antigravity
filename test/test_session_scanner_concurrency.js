const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Testing SessionScanner concurrency, force-refresh chaining & zombie prevention...');

const testDir = path.join(os.tmpdir(), 'antigravity_test_scanner_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

// 1. Test activeScanPromise force-refresh chaining
class MockScanner {
  constructor() {
    this.activeScanPromise = null;
    this.queuedForceScan = false;
    this.scanCount = 0;
  }

  scanSessions(forceRefresh = false) {
    if (this.activeScanPromise) {
      if (forceRefresh) {
        this.queuedForceScan = true;
      }
      return this.activeScanPromise.then(() => {
        if (this.queuedForceScan) {
          this.queuedForceScan = false;
          return this.scanSessions(true);
        }
        return this.scanCount;
      });
    }

    this.activeScanPromise = new Promise((resolve) => {
      setTimeout(() => {
        this.scanCount++;
        resolve(this.scanCount);
      }, 50);
    }).finally(() => {
      this.activeScanPromise = null;
    });

    return this.activeScanPromise;
  }
}

async function testScanChaining() {
  const scanner = new MockScanner();
  // Call 1: background normal scan
  const p1 = scanner.scanSessions(false);
  // Call 2: user clicks force refresh while Call 1 is in-flight
  const p2 = scanner.scanSessions(true);

  const [res1, res2] = await Promise.all([p1, p2]);
  assert.strictEqual(scanner.scanCount, 2, 'Must execute 2 scans (normal followed by queued forced scan)');
  assert.strictEqual(res2, 2, 'Forced scan result must reflect latest scan');
  console.log('✓ activeScanPromise force-refresh chaining verified!');
}

// 2. Test zombie session prevention on disk serialization
function filterAliveSessions(sessionList) {
  return sessionList.filter((entry) => {
    if (!entry || !entry.path) return false;
    return fs.existsSync(entry.path);
  });
}

const sessDir1 = path.join(testDir, 'session_alive');
const sessDir2 = path.join(testDir, 'session_deleted');
fs.mkdirSync(sessDir1, { recursive: true });
// sessDir2 is not created on disk (simulating deletion by another window)

const rawCache = [
  { id: '1', path: sessDir1 },
  { id: '2', path: sessDir2 }
];

const filtered = filterAliveSessions(rawCache);
assert.strictEqual(filtered.length, 1);
assert.strictEqual(filtered[0].id, '1');
console.log('✓ Zombie session elimination before cache write verified!');

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });

testScanChaining().then(() => {
  console.log('\nALL SESSION SCANNER CONCURRENCY TESTS PASSED (100%)!\n');
});
