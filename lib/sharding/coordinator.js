const os = require('node:os');
const { randomUUID } = require('node:crypto');

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveProvider(config = {}) {
  const provider = normalizeProviderName(config.database?.primary || 'sqlite');
  const registry = {
    mongodb: './providers/mongodb',
    redis: './providers/redis',
    mysql: './providers/mysql',
    postgres: './providers/postgres',
  };

  if (!registry[provider]) {
    throw new Error('Shard coordination requires an external database provider. Set database.primary to mongodb, redis, mysql, or postgres.');
  }

  return require(registry[provider]);
}

function createCoordinator(config = {}, options = {}) {
  const Provider = resolveProvider(config);
  const provider = new Provider(config, {
    instanceId: options.instanceId || `${os.hostname()}-${process.pid}-${randomUUID()}`,
    hostname: options.hostname || os.hostname(),
    pid: options.pid || process.pid,
    heartbeatInterval: Number(options.heartbeatInterval ?? config.sharding?.heartbeatInterval ?? 30000),
    timeout: Number(options.timeout ?? config.sharding?.timeout ?? 120000),
    key: options.key || 'realmsbot:shards',
  });

  return {
    async init() {
      await provider.connect?.();
      return this;
    },

    async claimShard(shardId) {
      const id = Number(shardId);
      if (!Number.isInteger(id)) {
        throw new Error(`Invalid shard id: ${shardId}`);
      }
      return provider.claimShard(id, {
        instanceId: provider.instanceId,
        hostname: provider.hostname,
        pid: provider.pid,
        heartbeatInterval: provider.heartbeatInterval,
        timeout: provider.timeout,
      });
    },

    async releaseShard(shardId) {
      return provider.releaseShard(Number(shardId), provider.instanceId);
    },

    async heartbeat(shardId) {
      return provider.heartbeat(Number(shardId), provider.instanceId);
    },

    async getActiveShards() {
      return provider.getActiveShards();
    },

    get provider() {
      return provider;
    },
  };
}

module.exports = { createCoordinator, normalizeProviderName, resolveProvider };
