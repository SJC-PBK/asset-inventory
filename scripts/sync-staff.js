// 직원 명부 → 이 앱. 표준 입력으로 탭 구분 글을 받는다(첫 줄 머리글: email name dept position status).
// 예: 인사·그룹웨어 DB 에서 뽑아 매일 넘긴다 — mysql -B -e "SELECT email,name,dept,position,status FROM …" | node scripts/sync-staff.js
const staff = require('../src/models/staff');

let text = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { text += d; });
process.stdin.on('end', () => {
  const lines = text.split(/\r?\n/).filter(Boolean);
  lines.shift(); // 머리글
  const rows = lines.map((l) => {
    const [email, name, dept, position, status] = l.split('\t').map((x) => (x === 'NULL' ? '' : x || '').trim());
    return { email: (email || '').toLowerCase(), name, dept, position, status };
  });
  try {
    const n = staff.replaceAll(rows);
    console.log(`직원 명부 ${n}명을 맞췄습니다.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
});
