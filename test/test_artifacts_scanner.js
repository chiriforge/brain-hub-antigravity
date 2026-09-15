const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
// Mock vscode module for standalone node execution
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => def
        })
      },
      Uri: {
        file: (f) => ({ fsPath: f, path: f, scheme: 'file' })
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { SessionScanner } = require('../out/services/SessionScanner');

console.log('Testing SessionScanner Artifact Discovery & Prompt Binding...');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-hub-artifacts-test-'));

try {
  // 1. Create simulated session directory structure
  const sessionDir = path.join(tempDir, 'test-session-001');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(sessionDir, '.user_uploaded'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'scratch'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, '.tempmediaStorage'), { recursive: true });

  // Files in root
  fs.writeFileSync(path.join(sessionDir, 'implementation_plan.md'), '# Implementation Plan');
  fs.writeFileSync(path.join(sessionDir, 'walkthrough.md'), '# Walkthrough');
  fs.writeFileSync(path.join(sessionDir, 'custom_analysis.md'), '# Analysis Results');
  fs.writeFileSync(path.join(sessionDir, 'dashboard_mockup.png'), 'fake-png-bytes');
  fs.writeFileSync(path.join(sessionDir, 'flow_diagram.svg'), '<svg></svg>');
  fs.writeFileSync(path.join(sessionDir, 'session_recording.webp'), 'fake-webp-bytes');
  fs.writeFileSync(path.join(sessionDir, 'metadata.json'), '{"id":"test-session-001"}'); // Should be ignored

  // Files in subdirectories
  fs.writeFileSync(path.join(sessionDir, '.user_uploaded', 'user_photo.jpg'), 'fake-jpg-bytes');
  fs.writeFileSync(path.join(sessionDir, 'scratch', 'test_script.py'), 'print("hello")');
  fs.writeFileSync(path.join(sessionDir, '.tempmediaStorage', 'temp_preview.png'), 'fake-preview-bytes');

  // 2. Simulated messages with tool calls for prompt context extraction
  const simulatedMessages = [
    {
      index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'I generated the mockup for you.',
      toolCalls: [
        {
          name: 'generate_image',
          args: {
            ImageName: 'dashboard_mockup',
            Prompt: 'Dark mode cybernetic dashboard UI mockup with neon blue accents',
            AspectRatio: '16:9'
          }
        },
        {
          name: 'browser_subagent',
          args: {
            RecordingName: 'session_recording',
            TaskSummary: 'Autonomous navigation and test recording of checkout flow'
          }
        }
      ]
    }
  ];

  const scanner = SessionScanner.getInstance();

  // Test 1: hasAnyArtifacts
  console.log('1. Testing hasAnyArtifacts...');
  assert.strictEqual(scanner.hasAnyArtifacts(sessionDir), true, 'hasAnyArtifacts should return true for session with artifacts');

  const emptyDir = path.join(tempDir, 'empty-session');
  fs.mkdirSync(emptyDir, { recursive: true });
  assert.strictEqual(scanner.hasAnyArtifacts(emptyDir), false, 'hasAnyArtifacts should return false for empty directory');
  console.log('✓ hasAnyArtifacts tests passed!');

  // Test 2: scanSessionArtifacts
  console.log('2. Testing scanSessionArtifacts discovery and classification...');
  const artifacts = scanner.scanSessionArtifacts(sessionDir, simulatedMessages);

  assert(Array.isArray(artifacts), 'artifacts should be an array');
  assert(artifacts.length >= 8, `Expected at least 8 artifacts, found ${artifacts.length}`);

  // Find specific items
  const plan = artifacts.find(a => a.name === 'implementation_plan.md');
  assert(plan, 'implementation_plan.md not found');
  assert.strictEqual(plan.category, 'document');
  assert.strictEqual(plan.source, 'plan');
  assert.strictEqual(plan.mimeType, 'text/markdown');

  const walkthrough = artifacts.find(a => a.name === 'walkthrough.md');
  assert(walkthrough, 'walkthrough.md not found');
  assert.strictEqual(walkthrough.category, 'document');
  assert.strictEqual(walkthrough.source, 'walkthrough');

  const analysis = artifacts.find(a => a.name === 'custom_analysis.md');
  assert(analysis, 'custom_analysis.md not found');
  assert.strictEqual(analysis.category, 'document');
  assert.strictEqual(analysis.source, 'ai_generated');

  const mockup = artifacts.find(a => a.name === 'dashboard_mockup.png');
  assert(mockup, 'dashboard_mockup.png not found');
  assert.strictEqual(mockup.category, 'image');
  assert.strictEqual(mockup.source, 'ai_generated');
  assert.strictEqual(mockup.prompt, 'Dark mode cybernetic dashboard UI mockup with neon blue accents', 'Prompt binding failed for dashboard_mockup.png');

  const recording = artifacts.find(a => a.name === 'session_recording.webp');
  assert(recording, 'session_recording.webp not found');
  assert.strictEqual(recording.category, 'video', 'Recording should be categorized as video');
  assert.strictEqual(recording.prompt, 'Autonomous navigation and test recording of checkout flow', 'Prompt binding failed for session_recording.webp');

  const userPhoto = artifacts.find(a => a.name === 'user_photo.jpg');
  assert(userPhoto, 'user_photo.jpg not found');
  assert.strictEqual(userPhoto.category, 'image');
  assert.strictEqual(userPhoto.source, 'user_uploaded');

  const scratchScript = artifacts.find(a => a.name === 'test_script.py');
  assert(scratchScript, 'test_script.py not found');
  assert.strictEqual(scratchScript.category, 'scratch');
  assert.strictEqual(scratchScript.source, 'scratch');

  // Verify internal metadata.json is excluded
  const meta = artifacts.find(a => a.name === 'metadata.json');
  assert(!meta, 'metadata.json should be excluded from artifacts list');

  console.log(`✓ All ${artifacts.length} artifacts discovered and classified successfully!`);
  console.log('✓ Prompt context binding verified!');

  console.log('=== All SessionScanner Artifact Tests Passed Successfully! ===');
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
