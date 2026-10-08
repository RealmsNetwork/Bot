const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoordinator } = require('../lib/sharding/coordinator');

class MemoryShardProvider {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.instanceId = options.instanceId || 'instance-a';
    this.hostname = options.hostname || 'localhost';
    this.pid = options.pid || 1;
    this.heartbeatInterval = Number(options.heartbeatInterval || config.sharding?.heartbeatInterval || 30000);
    this.timeout = Number(options.timeout || config.sharding?.timeout || 120000);
    this.registry = MemoryShardProvider.registry || new Map();
    MemoryShardProvider.registry = this.registry;
  }

  async connect() {}

  async claimShard(shardId, meta = {}) {
    const now = Date.now();
    const current = this.registry.get(String(shardId));
    if (current && current.status === 'online' && (now - Number(current.heartbeat || 0)) < this.timeout) {
      return false;
    }
    this.registry.set(String(shardId), {
      shardId: Number(shardId),
      instanceId: meta.instanceId || this.instanceId,
      hostname: meta.hostname || this.hostname,
      pid: meta.pid || this.pid,
      heartbeat: now,
      status: 'online',
    });
    return true;
  }

  async releaseShard(shardId, instanceId) {
    const current = this.registry.get(String(shardId));
    if (!current || current.instanceId !== instanceId) return true;
    this.registry.delete(String(shardId));
    return true;
  }

  async heartbeat(shardId, instanceId) {
    const current = this.registry.get(String(shardId));
    if (!current || current.instanceId !== instanceId) return false;
    current.heartbeat = Date.now();
    current.status = 'online';
    this.registry.set(String(shardId), current);
    return true;
  }

  async getActiveShards() {
    const cutoff = Date.now() - this.timeout;
    return [...this.registry.values()]
      .filter((row) => row.status === 'online' && Number(row.heartbeat || 0) >= cutoff)
      .map((row) => ({ ...row, shardId: Number(row.shardId), pid: Number(row.pid), heartbeat: Number(row.heartbeat) }))
      .sort((a, b) => a.shardId - b.shardId);
  }
}

function makeConfig() {
  return {
    database: { primary: 'mongodb' },
    sharding: { heartbeatInterval: 30000, timeout: 120000 },
  };
}

test('single instance claims shard 0+', async () => {
  const provider = new MemoryShardProvider(makeConfig(), { instanceId: 'instance-a' });
  assert.equal(await provider.claimShard(0, { instanceId: 'instance-a', hostname: 'host-a', pid: 123 }), true);
  assert.equal(await provider.claimShard(1, { instanceId: 'instance-a', hostname: 'host-a', pid: 123 }), true);
});

test('same shard cannot be claimed twice while active', async () => {
  const provider = new MemoryShardProvider(makeConfig(), { instanceId: 'instance-a' });
  await provider.claimShard(0, { instanceId: 'instance-a', hostname: 'host-a', pid: 123 });
  const second = await provider.claimShard(0, { instanceId: 'instance-b', hostname: 'host-b', pid: 456 });
  assert.equal(second, false);
});

test('dead shard can be reclaimed after timeout', async () => {
  const provider = new MemoryShardProvider(makeConfig(), { instanceId: 'instance-a' });
  provider.timeout = 5;
  await provider.claimShard(2, { instanceId: 'instance-a', hostname: 'host-a', pid: 123 });
  const stale = { ...provider.registry.get('2'), heartbeat: Date.now() - 2000 };
  provider.registry.set('2', stale);
  const claimed = await provider.claimShard(2, { instanceId: 'instance-b', hostname: 'host-b', pid: 456 });
  assert.equal(claimed, true);
});

test('coordinator exposes the required API', async () => {
  const coordinator = createCoordinator(makeConfig(), { instanceId: 'instance-1' });
  assert.ok(coordinator.claimShard);
  assert.ok(coordinator.releaseShard);
  assert.ok(coordinator.heartbeat);
  assert.ok(coordinator.getActiveShards);
  assert.equal(typeof coordinator.claimShard, 'function');
  assert.equal(typeof coordinator.releaseShard, 'function');
  assert.equal(typeof coordinator.heartbeat, 'function');
  assert.equal(typeof coordinator.getActiveShards, 'function');
});
