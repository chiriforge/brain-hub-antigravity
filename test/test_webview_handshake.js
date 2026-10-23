const assert = require('assert');

console.log('Testing webview handshake queue & sequence token guard...');

// Simulate the DashboardWebviewPanel message dispatcher
class MockDashboardWebview {
  constructor() {
    this.isWebviewReady = false;
    this.pendingReaderUpdate = null;
    this.activeReaderSequenceId = 0;
    this.renderedSession = null;
    this.dispatchedMessages = [];
  }

  // Simulated webview postMessage
  postMessage(message) {
    this.dispatchedMessages.push(message);
    if (message.type === 'renderActiveSession') {
      this.renderedSession = message.sessionId;
    }
  }

  // Called when extension wants to update reader
  updateReader(sessionId, delayMs = 0) {
    const sequenceId = ++this.activeReaderSequenceId;

    if (!this.isWebviewReady) {
      this.pendingReaderUpdate = { sessionId, sequenceId };
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        // Guard against out-of-order execution
        if (sequenceId !== this.activeReaderSequenceId) {
          // Superseded by newer session click -> discard
          resolve(false);
          return;
        }
        this.postMessage({ type: 'renderActiveSession', sessionId });
        resolve(true);
      }, delayMs);
    });
  }

  // Called when webview posts 'dashboardReady'
  handleDashboardReady() {
    this.isWebviewReady = true;
    if (this.pendingReaderUpdate) {
      const { sessionId, sequenceId } = this.pendingReaderUpdate;
      this.pendingReaderUpdate = null;
      if (sequenceId === this.activeReaderSequenceId) {
        this.postMessage({ type: 'renderActiveSession', sessionId });
      }
    }
  }
}

async function runTests() {
  // Test 1: Messages queued before handshake, flushed immediately upon ready
  const panel1 = new MockDashboardWebview();
  panel1.updateReader('session_initial');
  assert.strictEqual(panel1.isWebviewReady, false);
  assert.strictEqual(panel1.renderedSession, null, 'Must not render before ready');
  assert.deepStrictEqual(panel1.pendingReaderUpdate, { sessionId: 'session_initial', sequenceId: 1 });

  panel1.handleDashboardReady();
  assert.strictEqual(panel1.isWebviewReady, true);
  assert.strictEqual(panel1.renderedSession, 'session_initial', 'Pending session must flush upon ready');
  assert.strictEqual(panel1.pendingReaderUpdate, null);
  console.log('✓ Handshake message queue verified!');

  // Test 2: Sequence Token prevents out-of-order session overwrite
  const panel2 = new MockDashboardWebview();
  panel2.handleDashboardReady();

  // User clicks Session A (slow, 150ms delay)
  const pA = panel2.updateReader('session_A_large', 150);
  // User rapidly clicks Session B (fast, 20ms delay)
  const pB = panel2.updateReader('session_B_small', 20);

  await Promise.all([pA, pB]);

  // Session B was clicked second (sequenceId 2), so even though Session A finishes later,
  // Session B MUST remain the rendered session.
  assert.strictEqual(panel2.renderedSession, 'session_B_small', 'Session B must not be overwritten by Session A');
  console.log('✓ Out-of-order sequence token guard verified!');

  console.log('\nALL WEBVIEW HANDSHAKE & SEQUENCE TESTS PASSED (100%)!\n');
}

runTests();
