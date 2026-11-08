const db = require('../db');

const KINDS = { location: '현재위치', holder: '현 사용자', dept: '담당부서', category: '품목종류' };

function list(kind) {
  return db.prepare('SELECT value FROM options WHERE kind = ? ORDER BY sort, value').all(kind).map((r) => r.value);
}

function all() {
  const o = {};
  for (const k of Object.keys(KINDS)) o[k] = list(k);
  return o;
}

// 한 줄에 하나씩 적은 글을 그대로 목록으로 저장(순서 유지)
const replace = db.transaction((kind, text) => {
  if (!KINDS[kind]) throw new Error('알 수 없는 목록입니다.');
  const values = [...new Set(String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
  db.prepare('DELETE FROM options WHERE kind = ?').run(kind);
  const ins = db.prepare('INSERT INTO options (kind, value, sort) VALUES (?, ?, ?)');
  values.forEach((v, i) => ins.run(kind, v, i));
  return values.length;
});

// 자산을 저장할 때 목록에 없는 새 값이면 끝에 더한다
function remember(kind, value) {
  if (!value || !KINDS[kind]) return;
  db.prepare(`INSERT OR IGNORE INTO options (kind, value, sort)
              VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM options WHERE kind = ?))`).run(kind, value, kind);
}

module.exports = { KINDS, list, all, replace, remember };
