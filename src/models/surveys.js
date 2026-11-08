const db = require('../db');
const assets = require('./assets');

function current() {
  return db.prepare("SELECT * FROM surveys WHERE closed_at = '' ORDER BY id DESC LIMIT 1").get();
}

function get(id) {
  return db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
}

function list() {
  return db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM survey_checks c WHERE c.survey_id = s.id) AS checked
                     FROM surveys s ORDER BY s.id DESC`).all();
}

// 새 회차를 열면 열려 있던 회차는 닫는다
const start = db.transaction((title, by) => {
  db.prepare("UPDATE surveys SET closed_at = datetime('now','localtime') WHERE closed_at = ''").run();
  return db.prepare('INSERT INTO surveys (title, started_by) VALUES (?, ?)').run(title.trim(), by).lastInsertRowid;
});

function close(id) {
  db.prepare("UPDATE surveys SET closed_at = datetime('now','localtime') WHERE id = ? AND closed_at = ''").run(id);
}

function checkOf(surveyId, assetId) {
  return db.prepare('SELECT * FROM survey_checks WHERE survey_id = ? AND asset_id = ?').get(surveyId, assetId);
}

// 조사 기록. 변동이 있으면 자산의 위치·사용자·부서를 고치고 이력을 남긴다(앱시트 봇 '자산조사변동사항발생')
const check = db.transaction((surveyId, assetId, input, by) => {
  const a = assets.get(assetId);
  if (!a) throw new Error(`관리번호 ${assetId} 자산이 없습니다.`);
  const changed = input.changed ? 1 : 0;
  const row = {
    survey_id: surveyId, asset_id: assetId, remark: String(input.remark || '').trim(), changed,
    location: changed ? String(input.location || '').trim() : a.location,
    holder: changed ? String(input.holder || '').trim() : a.holder,
    dept: changed ? String(input.dept || '').trim() : a.dept,
    by,
  };
  db.prepare(`INSERT INTO survey_checks (survey_id, asset_id, remark, changed, location, holder, dept, checked_by)
              VALUES (@survey_id, @asset_id, @remark, @changed, @location, @holder, @dept, @by)
              ON CONFLICT (survey_id, asset_id) DO UPDATE SET checked_at = datetime('now','localtime'),
                remark = @remark, changed = @changed, location = @location, holder = @holder, dept = @dept, checked_by = @by`)
    .run(row);
  if (changed) assets.update(assetId, { location: row.location, holder: row.holder, dept: row.dept }, by, '재물조사');
});

// 회차의 자산별 조사 현황. 조사 대상 = 사용 중 자산 + 이번 회차에 조사된 것
function progress(surveyId) {
  return db.prepare(`SELECT a.id, a.name, a.location, a.holder, a.dept, a.photo, a.disused, a.discard_date,
                            c.checked_at, c.remark, c.changed, c.checked_by
                     FROM assets a LEFT JOIN survey_checks c ON c.asset_id = a.id AND c.survey_id = ?
                     WHERE (a.disused = 0 AND a.discard_date = '') OR c.id IS NOT NULL
                     ORDER BY (c.id IS NOT NULL), a.location, a.id`).all(surveyId);
}

function checksOfAsset(assetId) {
  return db.prepare(`SELECT c.*, s.title FROM survey_checks c JOIN surveys s ON s.id = c.survey_id
                     WHERE c.asset_id = ? ORDER BY c.checked_at DESC`).all(assetId);
}

module.exports = { current, get, list, start, close, checkOf, check, progress, checksOfAsset };
