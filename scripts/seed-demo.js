// 시연용 지어낸 자료. 실제 센터 자산과 관계없다. 사용: DATA_DIR=... node scripts/seed-demo.js [--force]
const db = require('../src/db');
const assets = require('../src/models/assets');
const options = require('../src/models/options');
const surveys = require('../src/models/surveys');
const staff = require('../src/models/staff');

// 빌드마다 같은 결과가 나오는 난수
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

// 자산마다 이동 내역 0~2건. 마지막 이동의 '바뀐 뒤'가 지금 위치가 되도록 거꾸로 이어 만든다.
function moveHistory(locations, holders) {
  const rand = rng(20261105);
  const pick = (arr, not) => { const c = arr.filter((v) => v !== not); return c[Math.floor(rand() * c.length)]; };
  const by = ['hong', 'kim', 'lee'].map((id) => `${id}@example.org`);
  const ins = db.prepare(`INSERT INTO asset_history (asset_id, changed_at, reason, changes, name, spec, qty, unit_price, amount, purchase_date,
    prev_location, prev_holder, dept, approval_doc, note, changed_by)
    VALUES (@id, @at, '수정', @changes, @name, @spec, @qty, @unit_price, @amount, @purchase_date, @prev_location, @prev_holder, @dept, @approval_doc, @note, @by)`);
  const today = Date.now();
  for (const a of db.prepare('SELECT * FROM assets ORDER BY id').all()) {
    const n = Math.floor(rand() * 3);
    if (!n) continue;
    // 구매일 ~ 오늘 사이 날짜 n개, 오래된 순
    const start = new Date(a.purchase_date + 'T09:00:00').getTime();
    const times = Array.from({ length: n }, () => start + rand() * (today - start)).sort((x, y) => x - y);
    // 위치·사용자 사슬: [처음, …, 지금]
    const locs = [a.location], hold = [a.holder];
    for (let i = 0; i < n; i++) {
      locs.unshift(pick(locations, locs[0]));
      hold.unshift(rand() < 0.5 ? hold[0] : pick(holders, hold[0]));
    }
    times.forEach((t, i) => {
      const d = new Date(t);
      const at = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
        `${String(9 + Math.floor(rand() * 9)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00`;
      const changes = [`현재위치: ${locs[i]} → ${locs[i + 1]}`];
      if (hold[i] !== hold[i + 1]) changes.push(`현 사용자: ${hold[i]} → ${hold[i + 1]}`);
      ins.run({ ...a, at, changes: changes.join('\n'), prev_location: locs[i], prev_holder: hold[i], by: by[Math.floor(rand() * by.length)] });
    });
  }
}

// 시연 자료를 만든 사람으로 보일 이름(지어낸 직원)
const BY = 'hong@example.org';

function seed({ force = false } = {}) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM assets').get().n;
  if (n && !force) return false;
  db.exec('DELETE FROM survey_checks; DELETE FROM surveys; DELETE FROM disposals; DELETE FROM asset_history; DELETE FROM assets; DELETE FROM options; DELETE FROM roles; DELETE FROM staff;');

  const locations = ['1층 상담실', '2층 사무실', '2층 회의실', '3층 교육장', '3층 창고', '4층 대강당'];
  const depts = ['운영지원팀', '취업지원팀', '교육훈련팀'];
  const holders = ['홍길동', '김하늘', '이바다', '박구름', '최나무', '공용'];
  const categories = ['전산장비', '사무가구', '가전', '교육기자재', '집기'];
  options.replace('location', locations.join('\n'));
  options.replace('dept', depts.join('\n'));
  options.replace('holder', holders.join('\n'));
  options.replace('category', categories.join('\n'));

  const items = [
    ['노트북', '전산장비', '15인치 i5 16GB', 1, 1350000, 5], ['모니터', '전산장비', '27인치 QHD', 2, 289000, 5],
    ['데스크톱 컴퓨터', '전산장비', 'i5 / 16GB / SSD 512GB', 1, 980000, 5], ['레이저 복합기', '전산장비', 'A4 컬러', 1, 1890000, 6],
    ['사무용 책상', '사무가구', '1400×700', 4, 210000, 10], ['회의용 의자', '사무가구', '메쉬 등받이', 12, 89000, 8],
    ['양문형 냉장고', '가전', '800L', 1, 1620000, 7], ['전자레인지', '가전', '23L', 1, 129000, 6],
    ['빔프로젝터', '교육기자재', '5000안시', 1, 1450000, 6], ['전동 스크린', '교육기자재', '120인치', 1, 540000, 8],
    ['태블릿', '전산장비', '10.9인치 Wi-Fi', 3, 599000, 4], ['문서 세단기', '집기', 'A4 20매', 1, 320000, 6],
    ['캐비닛', '사무가구', '4단 철제', 2, 260000, 10], ['공기청정기', '가전', '60㎡', 2, 450000, 6],
    ['무선 마이크 세트', '교육기자재', '핸드 2 + 핀 2', 1, 780000, 6], ['화이트보드', '집기', '1800×1200 이동식', 1, 230000, 8],
    ['라벨 프린터', '전산장비', '감열식', 1, 179000, 5], ['카메라', '교육기자재', '미러리스 24MP', 1, 1190000, 5],
  ];
  let i = 0;
  for (const [name, category, spec, qty, unit_price, useful_life] of items) {
    const year = 2019 + (i % 8);
    // 올해 것은 지난달까지만(미래 구매일이 없게)
    const now = new Date();
    const months = year === now.getFullYear() ? Math.max(1, now.getMonth()) : 12;
    const date = `${year}-${String(1 + (i * 5) % months).padStart(2, '0')}-${String(3 + (i * 7) % 25).padStart(2, '0')}`;
    assets.create({
      name, category, spec, qty, unit_price, useful_life, purchase_date: date,
      location: locations[i % locations.length], holder: holders[i % holders.length], dept: depts[i % depts.length],
      approval_doc: `운영-${year}-${100 + i}`, note: i % 5 === 0 ? '시연용 예시 자료' : '',
    }, BY);
    i++;
  }
  // 예시 사진(demo/photos — 무료 사진·AI 변형). 시연판 워커가 /photos/demo-*.jpg 를 그 파일로 넘긴다
  const PHOTO = {
    노트북: 'laptop', 모니터: 'monitor', '데스크톱 컴퓨터': 'desktop', '레이저 복합기': 'printer', '사무용 책상': 'desk',
    '회의용 의자': 'chair', '양문형 냉장고': 'fridge', 태블릿: 'tablet', 캐비닛: 'cabinet', '무선 마이크 세트': 'mic',
    화이트보드: 'whiteboard', 카메라: 'camera', 전자레인지: 'microwave', '전동 스크린': 'screen', 빔프로젝터: 'projector',
    '문서 세단기': 'shredder', 공기청정기: 'purifier', '라벨 프린터': 'labelprinter',
  };
  const fs = require('fs');
  const path = require('path');
  for (const [name, key] of Object.entries(PHOTO)) {
    if (fs.existsSync(path.join(__dirname, '..', 'demo', 'photos', key + '.jpg'))) {
      db.prepare('UPDATE assets SET photo = ? WHERE name = ?').run(`demo-${key}.jpg`, name);
    }
  }
  const all = db.prepare('SELECT id FROM assets ORDER BY id').all().map((r) => r.id);
  moveHistory(locations, holders);
  assets.update(all[2], { location: '3층 교육장', holder: '공용' }, BY);
  assets.setDisused(all[0], { grade: 'C', decided_on: '2026-03-10', reason: '노후로 수리 불가', place: '3층 창고', opinion: '폐기' }, BY);
  assets.setDisused(all[1], { grade: 'D', decided_on: '2025-11-20', reason: '파손', place: '3층 창고', opinion: '폐기' }, BY);
  assets.discard(all[1], '2025-12-15', '폐기물 업체 처리', BY);
  // 불용·폐기 기록 시각을 실제 결정일·폐기일로
  db.prepare(`UPDATE asset_history SET changed_at = (SELECT decided_on || ' 10:00:00' FROM disposals d WHERE d.asset_id = asset_history.asset_id)
              WHERE changed_by = '${BY}' AND reason = '불용'`).run();
  db.prepare(`UPDATE asset_history SET changed_at = (SELECT discard_date || ' 15:00:00' FROM assets a WHERE a.id = asset_history.asset_id)
              WHERE changed_by = '${BY}' AND reason = '폐기'`).run();
  const sid = surveys.start(`${new Date().getFullYear()}년 정기 재물조사`, BY);
  for (const id of all.slice(3, 9)) surveys.check(sid, id, { remark: '' }, BY);
  surveys.check(sid, all[9], { remark: '라벨 훼손', changed: true, location: '2층 회의실', holder: '공용', dept: '교육훈련팀' }, BY);
  db.prepare('UPDATE assets SET label_mark = 1 WHERE id IN (?, ?)').run(all[4], all[5]);
  // 지어낸 직원 명부(실제 명부 아님)
  staff.replaceAll([
    ['hong', '홍길동', '운영지원팀', '팀장', 'active'], ['kim', '김하늘', '취업지원팀', '주임', 'active'],
    ['lee', '이바다', '교육훈련팀', '대리', 'active'], ['park', '박구름', '운영지원팀', '사원', 'leave'],
    ['choi', '최나무', '취업지원팀', '사원', 'retired'],
  ].map(([id, name, dept, position, status]) => ({ email: `${id}@example.org`, name, dept, position, status })));
  staff.grant('hong@example.org', BY);
  return true;
}

if (require.main === module) {
  const done = seed({ force: process.argv.includes('--force') });
  console.log(done ? '시연 자료를 넣었습니다.' : '이미 자료가 있어 그대로 둡니다(--force 로 덮어쓰기).');
}

module.exports = seed;
