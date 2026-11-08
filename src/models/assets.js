const db = require('../db');
const { amountOf } = require('../lib/calc');

// 입력 칸과 이름. 변동 기록·엑셀 가져오기가 같이 쓴다.
const FIELDS = {
  name: '품명', category: '품목종류', spec: '규격', qty: '수량', unit_price: '단가', amount: '금액',
  purchase_date: '구매일자', useful_life: '내용연수', location: '현재위치', holder: '현 사용자', dept: '담당부서',
  approval_doc: '관련기안', old_id: '원관리번호', note: '비고', label_mark: '라벨',
};
const NUMERIC = new Set(['qty', 'unit_price', 'amount', 'useful_life']);

function clean(input) {
  const out = {};
  for (const k of Object.keys(FIELDS)) {
    if (k === 'label_mark') { out[k] = input[k] ? 1 : 0; continue; }
    let v = input[k] == null ? '' : String(input[k]).trim();
    if (NUMERIC.has(k)) {
      v = v.replace(/[,\s원]/g, '');
      out[k] = v === '' || isNaN(Number(v)) ? null : Math.round(Number(v));
    } else out[k] = v;
  }
  if (out.purchase_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.purchase_date)) out.purchase_date = '';
  out.amount = amountOf(out.qty, out.unit_price, out.amount);
  return out;
}

function get(id) {
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
}

// 스캔·입력한 번호로 찾기: 그대로 → 대문자 → 원관리번호 순
function find(code) {
  const s = String(code || '').trim();
  if (!s) return null;
  return get(s) || get(s.toUpperCase()) || db.prepare('SELECT * FROM assets WHERE old_id = ? LIMIT 1').get(s) || null;
}

// filter: { q, dept, location, state: active|disused|discarded|all }
function list(filter = {}) {
  const where = [], args = {};
  const state = filter.state || 'active';
  if (state === 'active') where.push("disused = 0 AND discard_date = ''");
  if (state === 'disused') where.push("disused = 1 AND discard_date = ''");
  if (state === 'discarded') where.push("discard_date <> ''");
  if (filter.dept) { where.push('dept = @dept'); args.dept = filter.dept; }
  if (filter.location) { where.push('location = @location'); args.location = filter.location; }
  if (filter.q) {
    where.push(`(id LIKE @q OR old_id LIKE @q OR name LIKE @q OR spec LIKE @q OR holder LIKE @q
                 OR location LIKE @q OR category LIKE @q OR note LIKE @q OR approval_doc LIKE @q)`);
    args.q = `%${filter.q}%`;
  }
  const sql = `SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
  return db.prepare(sql).all(args);
}

// 다음 관리번호: S{연도}-{3자리}. 연도는 구매일자(없으면 올해)
function nextId(purchaseDate) {
  const year = /^\d{4}/.test(purchaseDate || '') ? purchaseDate.slice(0, 4) : String(new Date().getFullYear());
  const prefix = `S${year}-`;
  const rows = db.prepare('SELECT id FROM assets WHERE id LIKE ?').all(prefix + '%');
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.id.slice(prefix.length), 10);
    if (n > max) max = n;
  }
  return prefix + String(max + 1).padStart(3, '0');
}

function snapshot(a, reason, changes, by) {
  db.prepare(`INSERT INTO asset_history
    (asset_id, reason, changes, name, spec, qty, unit_price, amount, purchase_date,
     prev_location, prev_holder, dept, approval_doc, note, changed_by)
    VALUES (@id, @reason, @changes, @name, @spec, @qty, @unit_price, @amount, @purchase_date,
     @location, @holder, @dept, @approval_doc, @note, @by)`)
    .run({ ...a, reason, changes, by });
}

function diff(before, after) {
  const lines = [];
  for (const [k, label] of Object.entries(FIELDS)) {
    if (!(k in after)) continue;
    const a = before[k] ?? '', b = after[k] ?? '';
    if (String(a) !== String(b)) {
      if (k === 'label_mark') continue; // 라벨 표시는 기록하지 않는다
      lines.push(`${label}: ${a === '' ? '(없음)' : a} → ${b === '' ? '(없음)' : b}`);
    }
  }
  return lines.join('\n');
}

function create(input, by, id) {
  const data = clean(input);
  if (!data.name) throw new Error('품명을 입력해 주세요.');
  const newId = (id || '').trim() || nextId(data.purchase_date);
  if (get(newId)) throw new Error(`관리번호 ${newId} 는 이미 있습니다.`);
  db.prepare(`INSERT INTO assets (id, ${Object.keys(data).join(', ')}, updated_by)
              VALUES (@id, ${Object.keys(data).map((k) => '@' + k).join(', ')}, @by)`)
    .run({ ...data, id: newId, by });
  return newId;
}

// 바뀐 것이 있으면 바뀌기 전 모습을 자산변동사항에 남긴다
const update = db.transaction((id, input, by, reason = '수정') => {
  const before = get(id);
  if (!before) throw new Error('자산을 찾을 수 없습니다.');
  const data = clean({ ...before, ...input });
  if (!data.name) throw new Error('품명을 입력해 주세요.');
  const changes = diff(before, data);
  if (changes) snapshot(before, reason, changes, by);
  db.prepare(`UPDATE assets SET ${Object.keys(data).map((k) => `${k} = @${k}`).join(', ')},
              updated_at = datetime('now','localtime'), updated_by = @by WHERE id = @id`)
    .run({ ...data, id, by });
  return changes;
});

const rename = db.transaction((id, newId, by) => {
  newId = (newId || '').trim();
  if (!newId || newId === id) return id;
  if (get(newId)) throw new Error(`관리번호 ${newId} 는 이미 있습니다.`);
  const before = get(id);
  db.prepare("UPDATE assets SET id = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?").run(newId, by, id);
  snapshot({ ...before, id: newId }, '수정', `관리번호: ${id} → ${newId}`, by);
  return newId;
});

function setPhoto(id, file, by) {
  db.prepare("UPDATE assets SET photo = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?").run(file, by, id);
}

function remove(id) {
  return db.prepare('DELETE FROM assets WHERE id = ?').run(id).changes;
}

function history(id) {
  return db.prepare('SELECT * FROM asset_history WHERE asset_id = ? ORDER BY changed_at DESC, id DESC').all(id);
}

function allHistory(limit = 300) {
  return db.prepare(`SELECT h.*, a.name AS cur_name FROM asset_history h LEFT JOIN assets a ON a.id = h.asset_id
                     ORDER BY h.changed_at DESC, h.id DESC LIMIT ?`).all(limit);
}

// ── 불용·복구·폐기 ──────────────────────────────────────────
const DISPOSAL_FIELDS = ['grade', 'decided_on', 'reason', 'place', 'opinion', 'processed_on', 'result', 'note'];

function disposal(id) {
  return db.prepare('SELECT * FROM disposals WHERE asset_id = ?').get(id);
}

function disposals() {
  return db.prepare(`SELECT d.*, a.name, a.spec, a.amount, a.purchase_date, a.dept, a.discard_date, a.photo
                     FROM disposals d JOIN assets a ON a.id = d.asset_id ORDER BY d.moved_at DESC`).all();
}

function pickDisposal(input) {
  const o = {};
  for (const k of DISPOSAL_FIELDS) o[k] = input[k] == null ? '' : String(input[k]).trim();
  if (o.grade && !['A', 'B', 'C', 'D'].includes(o.grade)) o.grade = '';
  return o;
}

// 불용 처리(앱시트 '불용이전') 또는 불용 정보 고치기
const setDisused = db.transaction((id, input, by) => {
  const a = get(id);
  if (!a) throw new Error('자산을 찾을 수 없습니다.');
  const d = pickDisposal(input);
  if (disposal(id)) {
    db.prepare(`UPDATE disposals SET ${DISPOSAL_FIELDS.map((k) => `${k} = @${k}`).join(', ')} WHERE asset_id = @id`).run({ ...d, id });
    return;
  }
  db.prepare(`INSERT INTO disposals (asset_id, ${DISPOSAL_FIELDS.join(', ')}) VALUES (@id, ${DISPOSAL_FIELDS.map((k) => '@' + k).join(', ')})`).run({ ...d, id });
  snapshot(a, '불용', '처리상태: 사용중 → 불용', by);
  db.prepare("UPDATE assets SET disused = 1, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?").run(by, id);
});

// 불용 복구: 불용물품 줄을 지운다(앱시트 봇 '불용복구시목록삭제')
const restore = db.transaction((id, by) => {
  const a = get(id);
  if (!a || !a.disused) return;
  snapshot(a, '복구', '처리상태: 불용 → 사용중' + (a.discard_date ? `\n폐기일자: ${a.discard_date} → (없음)` : ''), by);
  db.prepare('DELETE FROM disposals WHERE asset_id = ?').run(id);
  db.prepare("UPDATE assets SET disused = 0, discard_date = '', discard_reason = '', updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?").run(by, id);
});

const discard = db.transaction((id, date, reason, by) => {
  const a = get(id);
  if (!a || !a.disused) throw new Error('불용 처리한 자산만 폐기 완료로 바꿀 수 있습니다.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('폐기일자를 입력해 주세요.');
  snapshot(a, '폐기', `처리상태: 불용 → 폐기완료\n폐기일자: ${date}`, by);
  db.prepare("UPDATE assets SET discard_date = ?, discard_reason = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?")
    .run(date, (reason || '').trim(), by, id);
});

function stats() {
  return db.prepare(`SELECT
      SUM(disused = 0 AND discard_date = '') AS active,
      SUM(disused = 1 AND discard_date = '') AS disused,
      SUM(discard_date <> '') AS discarded,
      SUM(CASE WHEN disused = 0 AND discard_date = '' THEN amount ELSE 0 END) AS active_amount
    FROM assets`).get();
}

module.exports = {
  FIELDS, clean, get, find, list, nextId, create, update, rename, setPhoto, remove, history, allHistory,
  disposal, disposals, setDisused, restore, discard, stats,
};
