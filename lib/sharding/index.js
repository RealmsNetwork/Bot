const { createCoordinator } = require('./coordinator');

async function createShardCoordinator(config = {}, options = {}) {
  const coordinator = createCoordinator(config, options);
  await coordinator.init();
  return coordinator;
}

async function discoverDiscordShards(token) {
  const response = await fetch('https://discord.com/api/v10/gateway/bot', {
    headers: {
      Authorization: `Bot ${token}`,
      'User-Agent': 'RealmsNetwork-Bot/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Discord gateway check failed: ${response.status}`);
  }

  const data = await response.json();
  return Number(data.shards || 1);
}

module.exports = { createShardCoordinator, discoverDiscordShards };
