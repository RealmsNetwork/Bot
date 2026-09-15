const { SlashCommandBuilder } = require('discord.js');

const providers = {
  openai: async (cfg, messages) => openAIStyle(cfg, messages, 'OPENAI_API_KEY'),
  groq: async (cfg, messages) => openAIStyle(cfg, messages, 'GROQ_API_KEY'),
  mistral: async (cfg, messages) => openAIStyle(cfg, messages, 'MISTRAL_API_KEY'),
  ollama: async (cfg, messages) => openAIStyle(cfg, messages, null, true),
  openai_compatible: async (cfg, messages) => openAIStyle(cfg, messages, cfg.apiKeyEnv || null)
};

async function openAIStyle(cfg, messages, envKey, ollama = false) {
  const key = envKey ? process.env[envKey] : (cfg.apiKey || '');
  const base = String(cfg.baseUrl || (ollama ? 'http://127.0.0.1:11434/v1' : '')).replace(/\/$/, '');
  if (!base) throw new Error('AI baseUrl is missing');
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const body = { model: cfg.model, messages, temperature: cfg.temperature, max_tokens: cfg.maxTokens };
  const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Provider returned ${response.status}`);
  return data?.choices?.[0]?.message?.content || '';
}

async function gemini(cfg, messages) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is missing');
  const model = cfg.model || 'gemini-2.5-flash';
  const contents = messages.filter(x => x.role !== 'system').map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] }));
  const system = messages.find(x => x.role === 'system')?.content;
  const body = { contents, generationConfig: { temperature: cfg.temperature, maxOutputTokens: cfg.maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini returned ${response.status}`);
  return data?.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') || '';
}

async function anthropic(cfg, messages) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is missing');
  const system = messages.find(x => x.role === 'system')?.content;
  const body = { model: cfg.model || 'claude-sonnet', max_tokens: cfg.maxTokens || 1024, temperature: cfg.temperature, messages: messages.filter(x => x.role !== 'system') };
  if (system) body.system = system;
  const response = await fetch(`${String(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic returned ${response.status}`);
  return data?.content?.map(x => x.text || '').join('') || '';
}

async function chat(cfg, messages) {
  const provider = cfg.provider || 'ollama';
  if (provider === 'gemini') return gemini(cfg, messages);
  if (provider === 'anthropic') return anthropic(cfg, messages);
  const fn = providers[provider];
  if (!fn) throw new Error(`Unsupported provider: ${provider}`);
  return fn(cfg, messages);
}

function command() {
  return {
    data: new SlashCommandBuilder().setName('ask').setDescription('Ask the configured AI provider').addStringOption(o => o.setName('prompt').setDescription('Your prompt').setRequired(true)),
    execute: async (interaction, client) => {
      const cfg = client.config.ai || {};
      const prompt = interaction.options.getString('prompt', true).slice(0, Number(cfg.maxInputLength || 6000));
      await interaction.deferReply();
      try {
        const text = await chat(cfg, [{ role: 'system', content: cfg.systemPrompt || 'You are a helpful Discord assistant for RealmsNetwork.' }, { role: 'user', content: prompt }]);
        await interaction.editReply(text.slice(0, 4000) || 'The AI returned an empty response.');
      } catch (e) { await interaction.editReply(`AI error: ${e.message}`); }
    }
  };
}

async function initialize(client, config, moduleConfig) {
  client.ai = { chat: (messages, override = {}) => chat({ ...(config.ai || {}), ...moduleConfig, ...override }, messages) };
}

module.exports = { initialize, commands: [command()] };
