// 직원 명부와 관리 권한
const db = require('../db');
const config = require('../config');

const STATUS = { active: '재직', leave: '휴직', retired: '퇴사' };

function count() {
  return db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;
}

function get(email) {
  return db.prepare('SELECT * FROM staff WHERE email = ?').get(String(email || '').toLowerCase());
}

function list() {
  return db.prepare(`SELECT s.*, r.granted_by, r.granted_at FROM staff s LEFT JOIN roles r ON r.email = s.email
                     ORDER BY s.status = 'retired', s.dept, s.name`).all();
}

function lastSync() {
  return (db.prepare('SELECT MAX(synced_at) AS t FROM staff').get() || {}).t || '';
}

// 들어올 수 있는가: 명부가 비어 있으면(동기화 전) 기관 메일이면 통과. 명부가 있으면 재직·휴직만. ADMINS 는 언제나.
function canEnter(email) {
  if (config.admins.includes(email)) return true;
  if (!count()) return true;
  const s = get(email);
  return !!s && s.status !== 'retired';
}

// 관리 권한: ADMINS(설정 파일) 또는 권한 표 — 퇴사자는 표에 있어도 아님.
// 둘 다 비어 있으면(처음 설치) 누구나 관리자.
function isAdmin(email) {
  if (config.admins.includes(email)) return true;
  const roles = db.prepare('SELECT COUNT(*) AS n FROM roles').get().n;
  if (!roles && !config.admins.length) return true;
  if (!db.prepare('SELECT 1 FROM roles WHERE email = ?').get(email)) return false;
  const s = get(email);
  return !s || s.status !== 'retired';
}

function grant(email, by) {
  if (!get(email)) throw new Error('직원 명부에 없는 계정입니다.');
  db.prepare('INSERT OR IGNORE INTO roles (email, granted_by) VALUES (?, ?)').run(email, by);
}

function revoke(email) {
  db.prepare('DELETE FROM roles WHERE email = ?').run(email);
}

// 명부 통째로 맞추기. rows: [{email,name,dept,position,status}]
const replaceAll = db.transaction((rows) => {
  const ok = rows.filter((r) => r.email && r.email.endsWith('@' + config.staffDomain));
  if (!ok.length) throw new Error('명부가 비어 있어 멈춥니다(기존 명부 유지).');
  db.prepare('DELETE FROM staff').run();
  const ins = db.prepare('INSERT OR REPLACE INTO staff (email, name, dept, position, status) VALUES (@email, @name, @dept, @position, @status)');
  for (const r of ok) ins.run(r);
  return ok.length;
});

module.exports = { STATUS, count, get, list, lastSync, canEnter, isAdmin, grant, revoke, replaceAll };
