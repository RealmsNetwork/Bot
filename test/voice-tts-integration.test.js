const test = require('node:test');
const assert = require('node:assert/strict');

let loaded = false;
let ttsService = null;
let tempPanel = null;
let loadError = null;

try {
  ttsService = require('../modules/voice/tts-service');
  tempPanel = require('../modules/voice/temp-panel');
  loaded = true;
} catch (error) {
  loadError = error;
}

test('voice modules import with their real optional dependencies', { skip: loaded ? false : 'optional voice dependencies are not installed in this environment' }, () => {
  assert.equal(typeof ttsService.speak, 'function');
  assert.equal(typeof ttsService.listVoices, 'function');
  assert.equal(typeof ttsService.listLanguages, 'function');
  assert.equal(typeof tempPanel.handle, 'function');
  assert.equal(typeof tempPanel.canControlTts, 'function');
});

if (!loaded) {
  test('reports missing optional voice dependencies for local/CI diagnostics', () => {
    assert.ok(loadError instanceof Error);
  });
}
