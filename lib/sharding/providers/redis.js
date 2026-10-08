class RedisShardProvider {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.instanceId = options.instanceId;
    this.hostname = options.hostname || 'localhost';
    this.pid = options.pid || process.pid;
    this.heartbeatInterval = Number(options.heartbeatInterval || config.sharding?.heartbeatInterval || 30000);
    this.timeout = Number(options.timeout || config.sharding?.timeout || 120000);
    this.key = options.key || 'realmsbot:shards';
    this.client = null;
  }

  async connect() {
    const { createClient } = require('redis');
    const url = this.config.database?.redis?.url || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.client = createClient({ url });
    this.client.on('error', () => {});
    await this.client.connect();
  }

  async claimShard(shardId, meta = {}) {
    const now = Date.now();
    const entries = await this.getActiveShards();
    const existing = entries.find((entry) => Number(entry.shardId) === Number(shardId));
    if (existing && (now - Number(existing.heartbeat || 0)) < this.timeout) {
      return false;
    }
    const record = {
      shardId,
      instanceId: meta.instanceId || this.instanceId,
      hostname: meta.hostname || this.hostname,
      pid: meta.pid || this.pid,
      heartbeat: now,
      status: 'online',
    };
    await this.client.hSet(this.key, String(shardId), JSON.stringify(record));
    return true;
  }

  async releaseShard(shardId, instanceId) {
    const current = await this.client.hGet(this.key, String(shardId));
    if (!current) return true;
    const record = JSON.parse(current);
    if (record.instanceId === instanceId) await this.client.hDel(this.key, String(shardId));
    return true;
  }

  async heartbeat(shardId, instanceId) {
    const current = await this.client.hGet(this.key, String(shardId));
    if (!current) return false;
    const record = JSON.parse(current);
    if (record.instanceId !== instanceId) return false;
    record.heartbeat = Date.now();
    record.status = 'online';
    record.hostname = this.hostname;
    record.pid = this.pid;
    await this.client.hSet(this.key, String(shardId), JSON.stringify(record));
    return true;
  }

  async getActiveShards() {
    const values = await this.client.hVals(this.key);
    const cutoff = Date.now() - this.timeout;
    return values
      .map((value) => {
        try { return JSON.parse(value); } catch { return null; }
      })
      .filter(Boolean)
      .filter((item) => item.status === 'online' && Number(item.heartbeat || 0) >= cutoff)
      .map((item) => ({
        shardId: Number(item.shardId),
        instanceId: item.instanceId,
        hostname: item.hostname,
        pid: Number(item.pid),
        heartbeat: Number(item.heartbeat),
        status: item.status || 'online',
      }))
      .sort((a, b) => a.shardId - b.shardId);
  }
}

module.exports = RedisShardProvider;
