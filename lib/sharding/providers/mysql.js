class MySQLShardProvider {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.instanceId = options.instanceId;
    this.hostname = options.hostname || 'localhost';
    this.pid = options.pid || process.pid;
    this.heartbeatInterval = Number(options.heartbeatInterval || config.sharding?.heartbeatInterval || 30000);
    this.timeout = Number(options.timeout || config.sharding?.timeout || 120000);
    this.key = options.key || 'realmsbot_shards';
    this.pool = null;
  }

  async connect() {
    const mysql = require('mysql2/promise');
    const uri = this.config.database?.mysql?.url || process.env.MYSQL_URL;
    if (!uri) throw new Error('MYSQL_URL is required for MySQL shard coordination');
    this.pool = mysql.createPool({ uri, waitForConnections: true, connectionLimit: this.config.database?.mysql?.connectionLimit || 5 });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.key} (shard_id INT PRIMARY KEY, instance_id VARCHAR(255) NOT NULL, hostname VARCHAR(255) NOT NULL, pid INT NOT NULL, heartbeat BIGINT NOT NULL, status VARCHAR(32) NOT NULL)`);
  }

  async claimShard(shardId, meta = {}) {
    const now = Date.now();
    const [rows] = await this.pool.query(`SELECT * FROM ${this.key} WHERE shard_id = ?`, [shardId]);
    if (rows[0] && rows[0].status === 'online' && (now - Number(rows[0].heartbeat || 0)) < this.timeout) {
      return false;
    }
    await this.pool.query(`INSERT INTO ${this.key} (shard_id, instance_id, hostname, pid, heartbeat, status) VALUES (?, ?, ?, ?, ?, 'online') ON DUPLICATE KEY UPDATE instance_id = VALUES(instance_id), hostname = VALUES(hostname), pid = VALUES(pid), heartbeat = VALUES(heartbeat), status = VALUES(status)`, [shardId, meta.instanceId || this.instanceId, meta.hostname || this.hostname, meta.pid || this.pid, now]);
    return true;
  }

  async releaseShard(shardId, instanceId) {
    await this.pool.query(`DELETE FROM ${this.key} WHERE shard_id = ? AND instance_id = ?`, [shardId, instanceId]);
    return true;
  }

  async heartbeat(shardId, instanceId) {
    const now = Date.now();
    const [result] = await this.pool.query(`UPDATE ${this.key} SET heartbeat = ?, status = 'online', hostname = ?, pid = ? WHERE shard_id = ? AND instance_id = ?`, [now, this.hostname, this.pid, shardId, instanceId]);
    return (result.affectedRows || 0) > 0;
  }

  async getActiveShards() {
    const cutoff = Date.now() - this.timeout;
    const [rows] = await this.pool.query(`SELECT * FROM ${this.key} WHERE status = 'online' AND heartbeat >= ? ORDER BY shard_id ASC`, [cutoff]);
    return rows.map((row) => ({
      shardId: Number(row.shard_id),
      instanceId: row.instance_id,
      hostname: row.hostname,
      pid: Number(row.pid),
      heartbeat: Number(row.heartbeat),
      status: row.status || 'online',
    }));
  }
}

module.exports = MySQLShardProvider;
