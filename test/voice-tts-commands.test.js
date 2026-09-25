const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@discordjs/voice') {
    return {
      AudioPlayerStatus: { Idle: 'idle', Playing: 'playing', Paused: 'paused' },
      VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
      StreamType: { Arbitrary: 'arbitrary' },
      createAudioPlayer: () => ({ on() {}, play() {}, stop() {}, pause() { return false; }, unpause() {} }),
      createAudioResource: () => ({}),
      joinVoiceChannel: () => ({ joinConfig: { channelId: 'voice-1' }, state: { status: 'ready' }, subscribe() {}, destroy() {} }),
      entersState: async () => {}
    };
  }
  if (request === 'node-edge-tts') return { EdgeTTS: class {} };
  return originalLoad.call(this, request, parent, isMain);
};

let tts;
let commands;
try {
  tts = require('../modules/voice/tts-service');
  commands = require('../modules/voice/tts-commands').commands;
} finally {
  Module._load = originalLoad;
}

test('/tts leaves omitted provider, language and voice undefined', async () => {
  const command = commands.find(x => x.data.name === 'tts');
  assert.ok(command);

  const client = {
    modules: new Map([['voice', {
      config: {
        tts: {
          enabled: true,
          allowPublicAudio: true,
          allowUserVoiceSelection: true,
          provider: 'edge',
          defaultVoice: 'en-US-AriaNeural',
          defaultLanguage: 'en-US'
        },
        temporaryVoice: {
          allowOwnerTts: true
        }
      }
    }]]),
    voiceRooms: new Map(),
    voiceTtsRooms: new Map()
  };

  const interaction = {
    client,
    guildId: '123456789012345678',
    user: { id: '223456789012345678' },
    member: { id: '223456789012345678', displayName: 'Tester', voice: { channelId: 'voice-1' } },
    deferred: false,
    replied: false,
    options: {
      getString(name) {
        if (name === 'text') return 'hello';
        return null;
      }
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.replied = true;
      this.replyPayload = payload;
      return payload;
    }
  };

  const originalSpeak = tts.speak;
  let received;
  tts.speak = async (...args) => {
    received = args;
  };

  try {
    await command.execute(interaction);
  } finally {
    tts.speak = originalSpeak;
  }

  assert.ok(received);
  assert.equal(received[2], 'hello');
  assert.equal(received[4].provider, undefined);
  assert.equal(received[4].lang, undefined);
  assert.equal(received[4].voice, undefined);
  assert.equal(interaction.replyPayload.content, 'Speaking now.');
});
