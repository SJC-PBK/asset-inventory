const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.join(config.dataDir, 'photos'), { recursive: true });

const db = new Database(path.join(config.dataDir, 'itemmanager.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

module.exports = db;
