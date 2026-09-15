const { EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const cache = { at: 0, countries: [] };

function cfg(client) { return client.modules.get('countryballs')?.config || {}; }
function fields(c) { return c.api?.fields || 'names.common,names.official,codes.alpha_2,codes.alpha_3,flag.emoji,flag.png,population,region,subregion,capitals,currencies,languages,timezones'; }

async function loadCountries(client, force = false) {
  const c = cfg(client);
  const ttl = Math.max(60, Number(c.api?.cacheMinutes || 360)) * 60000;
  if (!force && cache.countries.length && Date.now() - cache.at < ttl) return cache.countries;
  const base = String(c.api?.baseUrl || 'https://api.restcountries.com/countries/v5').replace(/\/$/, '');
  const url = `${base}?limit=100&response_fields=${encodeURIComponent(fields(c))}`;
  const headers = {};
  const key = c.api?.apiKeyEnv ? process.env[c.api.apiKeyEnv] : process.env.REST_COUNTRIES_API_KEY;
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Country API HTTP ${response.status}`);
  const payload = await response.json();
  const records = payload?.data?.objects || payload?.data || [];
  cache.countries = records.filter(x => x?.names?.common || x?.name?.common || x?.name);
  cache.at = Date.now();
  return cache.countries;
}

function nameOf(ball) { return ball?.names?.common || ball?.name?.common || ball?.name || 'Unknown'; }
function flagOf(ball) { return ball?.flag?.emoji || ''; }
function codeOf(ball) { return ball?.codes?.alpha_2 || ball?.cca2 || ''; }
function imageOf(ball) { return ball?.flag?.png || ball?.flags?.png || null; }
function rarityIndex(ball, countries) { const i = Math.max(0, countries.indexOf(ball)); const ratio = i / Math.max(1, countries.length - 1); return ratio < .6 ? 'Common' : ratio < .85 ? 'Uncommon' : ratio < .95 ? 'Rare' : ratio < .99 ? 'Epic' : 'Legendary'; }
async function profile(db, guildId, userId) { return db.get(guildId, `countryballs:${userId}`, { coins: 100, collection: {}, favorites: [] }); }

const command = new SlashCommandBuilder().setName('ball').setDescription('Countryball collection and game')
  .addSubcommand(s => s.setName('roll').setDescription('Spawn and collect a countryball'))
  .addSubcommand(s => s.setName('search').setDescription('Find a country').addStringOption(o => o.setName('query').setDescription('Country name or code').setRequired(true)))
  .addSubcommand(s => s.setName('profile').setDescription('View your collection'))
  .addSubcommand(s => s.setName('dex').setDescription('Show countries in the live API'))
  .addSubcommand(s => s.setName('refresh').setDescription('Refresh the country API cache'));

async function execute(interaction, client) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'refresh') { await loadCountries(client, true); return interaction.reply(`🌎 Refreshed **${cache.countries.length}** countries from the configured API.`); }
  const countries = await loadCountries(client);
  if (sub === 'search') {
    const q = interaction.options.getString('query', true).toLowerCase();
    const found = countries.find(x => nameOf(x).toLowerCase().includes(q) || codeOf(x).toLowerCase() === q);
    if (!found) return interaction.reply({ content: 'Country not found.', ephemeral: true });
    const embed = new EmbedBuilder().setColor(cfg(client).ui?.embedColor || client.config.branding.embedColor).setTitle(`${flagOf(found)} ${nameOf(found)}`).addFields({ name: 'ISO', value: codeOf(found) || 'N/A', inline: true }, { name: 'Region', value: String(found.region || 'N/A'), inline: true }, { name: 'Population', value: Number(found.population || 0).toLocaleString(), inline: true });
    if (found.capitals?.[0]?.name) embed.addFields({ name: 'Capital', value: found.capitals[0].name, inline: true });
    if (imageOf(found)) embed.setThumbnail(imageOf(found));
    return interaction.reply({ embeds: [embed] });
  }
  if (sub === 'dex') return interaction.reply(`🌎 Live country index: **${countries.length}** countries. Use `/ball search query:<country>` to inspect one.`);
  if (sub === 'profile') { const p = await profile(client.db, interaction.guildId, interaction.user.id); const entries = Object.entries(p.collection).sort((a,b) => b[1]-a[1]); return interaction.reply(`🌎 ${interaction.user} owns **${entries.reduce((n,[,v])=>n+v,0)}** ${cfg(client).collection?.pluralName || 'countryballs'} across **${entries.length}** countries.\n${entries.slice(0,20).map(([k,v])=>`• ${k}: ${v}`).join('\n') || 'No collection yet.'}`); }
  const p = await profile(client.db, interaction.guildId, interaction.user.id);
  const cost = 10;
  if (p.coins < cost) return interaction.reply({ content: `You need ${cost} coins. You have ${p.coins}.`, ephemeral: true });
  const ball = countries[Math.floor(Math.random() * countries.length)];
  const name = nameOf(ball);
  p.coins -= cost; p.collection[name] = (p.collection[name] || 0) + 1;
  await client.db.set(interaction.guildId, `countryballs:${interaction.user.id}`, p);
  const embed = new EmbedBuilder().setColor(cfg(client).ui?.embedColor || client.config.branding.embedColor).setTitle(`${flagOf(ball)} Countryball Caught`).setDescription(`${interaction.user} caught **${name}**!\n\n**Rarity:** ${rarityIndex(ball, countries)}\n**Copies:** ${p.collection[name]}\n**Coins:** ${p.coins}`);
  if (imageOf(ball)) embed.setThumbnail(imageOf(ball));
  return interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ball-favorite').setLabel('Favorite').setStyle(ButtonStyle.Secondary))] });
}

async function initialize(client) { client.countryballs = { loadCountries: force => loadCountries(client, force), profile }; loadCountries(client).catch(e => console.warn('[Countryballs] API:', e.message)); }
module.exports = { initialize, commands: [{ data: command, execute }] };
