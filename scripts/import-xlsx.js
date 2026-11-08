// 앱시트 원본(구글 시트 '자산목록' 파일을 .xlsx 로 내려받은 것) → 이 앱 DB.
// 사용: DATA_DIR=... node scripts/import-xlsx.js <파일.xlsx> [--photos <사진 폴더들이 든 폴더>] [--apply | --replace | --photos-only]
//   (아무것도 없음) 읽기만 하고 건수·문제만 보여 준다.
//   --apply        빈 DB 에만 넣는다.
//   --replace      지금 DB 를 backups/ 에 사본으로 남기고 모두 지운 뒤 다시 넣는다(전환하는 날 앱시트 최종본 반영용).
//                  직원이 이 앱에서 고친 기록이 있으면 멈춘다. 그래도 지우려면 --discard-app-edits 를 함께.
//   --photos-only  자산은 그대로 두고, 사진이 없는 자산에 앱시트 사진만 붙인다(--photos 필요).
// 시트: 자산목록 · 불용물품 · 자산변동사항 · 조사목록(진행 중 회차) · 조사목록25(2025 마감 회차) · DB (열은 이름으로 찾는다)
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { amountOf } = require('../src/lib/calc');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--photos');
const replace = args.includes('--replace');
const photosOnly = args.includes('--photos-only');
const apply = args.includes('--apply') || replace;
const photoDir = args.includes('--photos') ? args[args.indexOf('--photos') + 1] : '';
if (!file) { console.error('사용: node scripts/import-xlsx.js <파일.xlsx> [--photos 폴더] [--apply]'); process.exit(1); }

function pad(n) { return String(n).padStart(2, '0'); }
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v) ? '' : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if (v.error) return '';
  }
  return String(v).trim();
}
const dateOnly = (s) => { const m = /^(\d{4})[-./ ]\s*(\d{1,2})[-./ ]\s*(\d{1,2})/.exec(s); return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : ''; };
const dateTime = (s) => { const d = dateOnly(s); const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s); return d ? `${d} ${t ? `${pad(t[1])}:${t[2]}:${t[3] || '00'}` : '00:00:00'}` : ''; };
const yes = (s) => /^(true|y|yes|1|o|✓)$/i.test(s);

function rowsOf(wb, name) {
  const ws = wb.getWorksheet(name);
  if (!ws) return null;
  const head = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { head[i] = cellText(c.value); });
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = cellText(row.getCell(i).value); });
    if (Object.values(o).some(Boolean)) out.push(o);
  });
  return out;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const src = {};
  for (const n of ['자산목록', '불용물품', '자산변동사항', '조사목록', '조사목록25', 'DB']) src[n] = rowsOf(wb, n);
  for (const [n, r] of Object.entries(src)) console.log(`${n}: ${r ? r.length + '줄' : '시트 없음'}`);
  if (!src['자산목록']) { console.error("'자산목록' 시트가 없습니다."); process.exit(1); }

  const problems = [];
  const assetsIn = [];
  const seen = new Set();
  for (const r of src['자산목록']) {
    const id = r['관리번호'];
    if (!id) { if (r['품명']) problems.push(`관리번호 없음: ${r['품명']}`); continue; }
    if (seen.has(id)) { problems.push(`관리번호 겹침: ${id}`); continue; }
    seen.add(id);
    const num = (k) => { const v = (r[k] || '').replace(/[,\s원]/g, ''); return v === '' || isNaN(Number(v)) ? null : Math.round(Number(v)); };
    let photo = (r['앱시트사진'] || '').trim();
    if (photo && photoDir) {
      // 값은 '자산목록_Images/파일.jpg' 꼴 — --photos 는 그 폴더들이 들어 있는 상위 폴더(또는 사진 폴더 자체)
      const from = [path.join(photoDir, photo), path.join(photoDir, path.basename(photo))].find((f) => fs.existsSync(f));
      if (from) photo = { from }; else { problems.push(`사진 파일 없음: ${id} ${photo}`); photo = ''; }
    } else photo = '';
    assetsIn.push({
      id, old_id: r['원관리번호'] || '', name: r['품명'] || '(품명 없음)', category: r['품목종류'] || '', spec: r['규격'] || '',
      qty: num('수량'), unit_price: num('단가'), amount: amountOf(num('수량'), num('단가'), num('금액')), purchase_date: dateOnly(r['구매일자'] || ''),
      useful_life: num('내용연수'), location: r['현재위치'] || '', holder: r['현 사용자'] || '', dept: r['담당부서'] || '',
      approval_doc: r['관련기안'] || '',
      note: [r['비고'] || '', r['폐기일자'] && !dateOnly(r['폐기일자']) ? `(앱시트 폐기일자 원래 값: ${r['폐기일자']})` : ''].filter(Boolean).join('\n'), label_mark: yes(r['라벨'] || '') ? 1 : 0,
      disused: yes(r['불용처리'] || '') || !!r['폐기일자'] ? 1 : 0, discard_date: dateOnly(r['폐기일자'] || ''), discard_reason: r['폐기사유'] || '',
      photo,
    });
    if (!r['품명']) problems.push(`품명 없음: ${id}`);
    if (r['폐기일자'] && !dateOnly(r['폐기일자'])) problems.push(`폐기일자가 날짜가 아님: ${id} '${r['폐기일자']}' → 불용으로 두고 비고에 남김`);
  }
  console.log(`가져올 자산 ${assetsIn.length}건 (불용 ${assetsIn.filter((a) => a.disused).length}, 사진 ${assetsIn.filter((a) => a.photo).length})`);
  if (problems.length) console.log('확인할 점:\n  ' + problems.slice(0, 50).join('\n  ') + (problems.length > 50 ? `\n  …외 ${problems.length - 50}건` : ''));
  if (photoDir) console.log(`사진 폴더에서 찾은 사진 ${assetsIn.filter((a) => a.photo).length}장`);
  if (!apply && !photosOnly) { console.log('\n미리보기만 했습니다. 넣으려면 --apply(빈 DB) 또는 --replace(다시 넣기)를 붙이세요.'); return; }

  const db = require('../src/db');
  const config = require('../src/config');
  const copyPhoto = (a) => {
    const name = `${a.id.replace(/[^\w-]/g, '_')}-import${path.extname(a.photo.from).toLowerCase() || '.jpg'}`;
    fs.copyFileSync(a.photo.from, path.join(config.dataDir, 'photos', name));
    return name;
  };
  if (photosOnly) {
    if (!photoDir) { console.error('--photos-only 에는 --photos <폴더> 가 필요합니다.'); process.exit(1); }
    let n = 0;
    for (const a of assetsIn) {
      if (!a.photo) continue;
      const cur = db.prepare('SELECT photo FROM assets WHERE id = ?').get(a.id);
      if (!cur || cur.photo) continue;
      db.prepare('UPDATE assets SET photo = ? WHERE id = ?').run(copyPhoto(a), a.id);
      n++;
    }
    console.log(`사진 ${n}장을 붙였습니다(이미 사진이 있는 자산은 건드리지 않음).`);
    return;
  }
  if (db.prepare('SELECT COUNT(*) n FROM assets').get().n) {
    if (!replace) { console.error('DB 에 이미 자산이 있어 멈춥니다. 다시 넣으려면 --replace.'); process.exit(1); }
    // 이 앱에서 사람이 한 일(앱시트에서 옮긴 것·시연 자료가 아닌 것)이 있으면 함부로 지우지 않는다
    const mine = "NOT IN ('앱시트', '앱시트 이전', 'seed')";
    const edits = {
      자산수정: db.prepare(`SELECT COUNT(*) n FROM assets WHERE updated_by ${mine}`).get().n,
      변동이력: db.prepare(`SELECT COUNT(*) n FROM asset_history WHERE changed_by ${mine}`).get().n,
      조사기록: db.prepare(`SELECT COUNT(*) n FROM survey_checks WHERE checked_by ${mine}`).get().n,
    };
    if (Object.values(edits).some(Boolean) && !args.includes('--discard-app-edits')) {
      console.error('이 앱에서 직원이 입력한 기록이 있어 멈춥니다:', JSON.stringify(edits));
      console.error('다시 넣으면 이 기록이 사라집니다. 정말 지우려면 --discard-app-edits 를 함께 붙이세요.');
      process.exit(1);
    }
    const dir = path.join(config.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const bak = path.join(dir, `before-replace-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.db`);
    await db.backup(bak);
    console.log(`지우기 전 사본: ${bak}`);
    db.exec('DELETE FROM survey_checks; DELETE FROM surveys; DELETE FROM disposals; DELETE FROM asset_history; DELETE FROM assets; DELETE FROM options;');
  }
  const cols = ['id', 'old_id', 'name', 'category', 'spec', 'qty', 'unit_price', 'amount', 'purchase_date', 'useful_life', 'location', 'holder',
    'dept', 'approval_doc', 'note', 'label_mark', 'disused', 'discard_date', 'discard_reason', 'photo'];
  const insA = db.prepare(`INSERT INTO assets (${cols.join(',')}, updated_by) VALUES (${cols.map((c) => '@' + c).join(',')}, '앱시트 이전')`);
  const known = new Set(assetsIn.map((a) => a.id));
  let photos = 0, skipped = 0;
  db.transaction(() => {
    for (const a of assetsIn) {
      if (a.photo) { a.photo = copyPhoto(a); photos++; }
      insA.run(a);
    }
    for (const r of src['불용물품'] || []) {
      if (!known.has(r['관리번호'])) { skipped++; continue; }
      db.prepare(`INSERT OR REPLACE INTO disposals (asset_id, moved_at, grade, decided_on, reason, place, opinion, processed_on, result, note)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(r['관리번호'], dateTime(r['불용이감일시'] || '') || dateTime(r['처리일자'] || '') || '2000-01-01 00:00:00',
        r['상태'] || '', dateOnly(r['불용결정일자'] || ''), r['불용결정사유'] || '', r['물품소재지'] || '', r['처분의견'] || '',
        dateOnly(r['처리일자'] || ''), r['처리결과'] || '', r['비고'] || '');
      db.prepare('UPDATE assets SET disused = 1 WHERE id = ?').run(r['관리번호']);
    }
    for (const r of src['자산변동사항'] || []) {
      if (!known.has(r['관리번호'])) { skipped++; continue; }
      const n = (k) => { const v = (r[k] || '').replace(/[,\s원]/g, ''); return v === '' || isNaN(Number(v)) ? null : Math.round(Number(v)); };
      db.prepare(`INSERT INTO asset_history (asset_id, changed_at, reason, name, spec, qty, unit_price, amount, purchase_date, prev_location, prev_holder, dept, approval_doc, note, changed_by)
        VALUES (?,?, '이전 기록', ?,?,?,?,?,?,?,?,?,?,?, '앱시트')`).run(r['관리번호'], dateTime(r['변동일시'] || '') || '2000-01-01 00:00:00',
        r['품명'] || '', r['규격'] || '', n('수량'), n('단가'), n('금액'), dateOnly(r['구매일자'] || ''), r['이전위치'] || '', r['이전 사용자'] || '',
        r['담당부서'] || '', r['관련기안'] || '', r['비고'] || '');
    }
    // 조사목록25 = 2025 조사(마감), 조사목록 = 지금 진행 중인 조사(이 앱에서 이어서 한다)
    for (const [sheet, open] of [['조사목록25', false], ['조사목록', true]]) {
      // 같은 자산을 여러 번 찍었으면 가장 늦은 기록이 남도록 시각 순으로 넣는다
      const checks = (src[sheet] || []).filter((r) => known.has(r['관리번호']))
        .sort((x, y) => dateTime(x['재물조사일시'] || '').localeCompare(dateTime(y['재물조사일시'] || '')));
      if (!checks.length) continue;
      const times = checks.map((r) => dateTime(r['재물조사일시'] || '')).filter(Boolean).sort();
      const year = (times[0] || '').slice(0, 4);
      const sid = db.prepare("INSERT INTO surveys (title, started_at, closed_at, started_by) VALUES (?, ?, ?, '앱시트')")
        .run(`${year}년 재물조사(앱시트${open ? '에서 이어받음' : ''})`, times[0] || '2000-01-01 00:00:00', open ? '' : times[times.length - 1]).lastInsertRowid;
      for (const r of checks) {
        db.prepare(`INSERT OR REPLACE INTO survey_checks (survey_id, asset_id, checked_at, remark, changed, location, holder, dept, checked_by)
          VALUES (?,?,?,?,?,?,?,?, '앱시트')`).run(sid, r['관리번호'], dateTime(r['재물조사일시'] || '') || '2000-01-01 00:00:00', r['조사특이사항'] || '',
          yes(r['변동여부'] || '') ? 1 : 0, r['현재위치'] || '', r['현 사용자'] || '', r['담당부서'] || '');
      }
    }
    const opt = db.prepare('INSERT OR IGNORE INTO options (kind, value, sort) VALUES (?,?,?)');
    for (const [kind, col] of [['location', '현재위치'], ['holder', '현 사용자'], ['dept', '담당부서']]) {
      (src['DB'] || []).map((r) => r[col]).filter(Boolean).forEach((v, i) => opt.run(kind, v, i));
      assetsIn.map((a) => a[kind]).filter(Boolean).forEach((v) => opt.run(kind, v, 9999));
    }
    assetsIn.map((a) => a.category).filter(Boolean).forEach((v) => opt.run('category', v, 9999));
  })();
  console.log(`넣었습니다: 자산 ${assetsIn.length}건, 사진 ${photos}장${skipped ? `, 관리번호가 자산목록에 없어 건너뛴 줄 ${skipped}` : ''}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
