// 하루 한 번 DB 사본(DATA_DIR/backups/itemmanager-YYYYMMDD.db, 14개 보관).
// 쓰는 중인 DB 파일을 그냥 복사하면 깨질 수 있어 SQLite 백업 기능으로 뜬다.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');

const dir = path.join(config.dataDir, 'backups');
const KEEP = 14;

async function run() {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const name = `itemmanager-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.db`;
  if (!fs.existsSync(path.join(dir, name))) await db.backup(path.join(dir, name));
  const old = fs.readdirSync(dir).filter((f) => /^itemmanager-\d{8}\.db$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
}

function start() {
  const tick = () => run().catch((e) => console.error('DB 사본 실패', e.message));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 6 * 60 * 60 * 1000).unref();
}

module.exports = { run, start };
