const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@discordjs/voice') {
    return {
      AudioPlayerStatus: { Idle: 'idle' },
      VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
      StreamType: { Arbitrary: 'arbitrary' },
      createAudioPlayer: () => ({ on() {}, play() {}, stop() {} }),
      createAudioResource: () => ({}),
      joinVoiceChannel: () => ({}),
      entersState: async () => {}
    };
  }
  if (request === 'node-edge-tts') {
    return { EdgeTTS: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let voicePanel;
let ttsService;
try {
  voicePanel = require('../modules/voice/temp-panel');
  ttsService = require('../modules/voice/tts-service');
} finally {
  Module._load = originalLoad;
}

const { panelSlug } = voicePanel;
const { languageList, parseLanguageCatalog, rateValue, volumeValue, settingsFor, speak } = ttsService;

function clientWithTts(tts = {}, temporaryVoice = {}) {
  return {
    config: { branding: {} },
    modules: new Map([['voice', {
      config: {
        tts: {
          enabled: true,
          provider: 'edge',
          defaultVoice: 'en-US-AriaNeural',
          defaultLanguage: 'en-US',
          maxRate: 100,
          maxVolume: 100,
          ...tts
        },
        temporaryVoice: {
          panelSuffix: '-panel',
          ...temporaryVoice
        }
      }
    }]])
  };
}

test('panelSlug never exceeds Discord channel name limit', () => {
  const client = clientWithTts();
  const name = panelSlug(client, 'a'.repeat(500));
  assert.ok(name.length <= 100);
  assert.equal(name.endsWith('-panel'), true);
});

test('panelSlug trims an oversized configured suffix safely', () => {
  const client = clientWithTts({}, { panelSuffix: 'x'.repeat(500) });
  const name = panelSlug(client, 'room');
  assert.equal(name.length, 100);
});

test('settingsFor clamps persisted TTS settings to configured limits', () => {
  const client = clientWithTts({ maxRate: 80, maxVolume: 40 });
  const room = {
    guildId: '1',
    voiceChannelId: '2',
    tts: { provider: 'not-a-provider', rate: 150, volume: 150 }
  };

  const settings = settingsFor(room, client);

  assert.equal(settings.provider, 'edge');
  assert.equal(settings.rate, 80);
  assert.equal(settings.volume, 40);
});

test('rate and volume values are encoded as provider percentages', () => {
  assert.equal(rateValue(100), 'default');
  assert.equal(rateValue(125), '+25%');
  assert.equal(rateValue(80), '-20%');
  assert.equal(volumeValue(100), 'default');
  assert.equal(volumeValue(150), '+50%');
  assert.equal(volumeValue(40), '-60%');
});


test('parseLanguageCatalog reads the nested Google language map', () => {
  const languages = parseLanguageCatalog({
    sl: { auto: 'Detect language' },
    tl: { en: 'English', es: 'Spanish', 'pt-BR': 'Portuguese (Brazil)' }
  });

  assert.equal(languages.length, 3);
  assert.deepEqual(new Set(languages.map(x => x.code)), new Set(['en', 'es', 'pt-BR']));
  assert.equal(languages.find(x => x.code === 'pt-BR').name, 'Portuguese (Brazil)');
});

test('languageList deduplicates locales by language code', () => {
  const languages = languageList([
    { Locale: 'en-US', LocaleName: 'English (United States)' },
    { Locale: 'en-GB', LocaleName: 'English (United Kingdom)' },
    { Locale: 'de-DE', LocaleName: 'German (Germany)' }
  ]);

  const english = languages.find(x => x.code === 'en');
  assert.ok(english);
  assert.deepEqual(english.locales, ['en-GB', 'en-US']);
});

test('speak rejects an unsupported provider before attempting voice setup', async () => {
  const client = clientWithTts();
  const room = { guildId: '1', voiceChannelId: '2', tts: {} };

  await assert.rejects(
    () => speak(client, room, 'hello', { id: '10', displayName: 'User' }, { provider: 'bogus' }),
    /Unsupported TTS provider: bogus/
  );
});
