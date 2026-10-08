const { MongoClient } = require('mongodb');

class MongoShardProvider {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.instanceId = options.instanceId;
    this.hostname = options.hostname || 'localhost';
    this.pid = options.pid || process.pid;
    this.heartbeatInterval = Number(options.heartbeatInterval || config.sharding?.heartbeatInterval || 30000);
    this.timeout = Number(options.timeout || config.sharding?.timeout || 120000);
    this.key = options.key || 'realmsbot:shards';
    this.client = null;
    this.collection = null;
  }

  async connect() {
    const uri = this.config.database?.mongodb?.url || process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required for MongoDB shard coordination');
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await this.client.connect();
    const db = this.client.db(this.config.database?.mongodb?.database || 'realmsbot');
    this.collection = db.collection(this.key.replace(/[^a-zA-Z0-9_-]/g, '_'));
    await this.collection.createIndex({ shardId: 1 }, { unique: true });
    await this.collection.createIndex({ heartbeat: 1 });
  }

  async claimShard(shardId, meta = {}) {
    const now = Date.now();
    const record = await this.collection.findOne({ shardId });
    if (record && record.status === 'online' && (now - Number(record.heartbeat || 0)) < this.timeout) {
      return false;
    }
    const next = {
      shardId,
      instanceId: meta.instanceId || this.instanceId,
      hostname: meta.hostname || this.hostname,
      pid: meta.pid || this.pid,
      heartbeat: now,
      status: 'online',
    };
    await this.collection.updateOne({ shardId }, { $set: next }, { upsert: true });
    return true;
  }

  async releaseShard(shardId, instanceId) {
    await this.collection.deleteOne({ shardId, instanceId });
    return true;
  }

  async heartbeat(shardId, instanceId) {
    const now = Date.now();
    const result = await this.collection.updateOne(
      { shardId, instanceId },
      { $set: { heartbeat: now, status: 'online', hostname: this.hostname, pid: this.pid } },
    );
    return result.modifiedCount > 0 || result.upsertedCount > 0;
  }

  async getActiveShards() {
    const cutoff = Date.now() - this.timeout;
    const rows = await this.collection.find({ status: 'online', heartbeat: { $gte: cutoff } }).toArray();
    return rows
      .map((row) => ({
        shardId: Number(row.shardId),
        instanceId: row.instanceId,
        hostname: row.hostname,
        pid: Number(row.pid),
        heartbeat: Number(row.heartbeat),
        status: row.status || 'online',
      }))
      .sort((a, b) => a.shardId - b.shardId);
  }
}

module.exports = MongoShardProvider;
