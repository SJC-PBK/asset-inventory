// 실행: npm test  (임시 DATA_DIR 에서 돈다 — 실제 자료에 닿지 않는다)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'itemmgr-test-'));
process.env.AUTH_MODE = 'sso';
process.env.SCV_SSO_SECRET = 'test-secret';
process.env.ADMINS = 'boss@example.org';

const sso = require('../src/lib/sso');
const calc = require('../src/lib/calc');
const assets = require('../src/models/assets');
const surveys = require('../src/models/surveys');
const app = require('../src/server');

const cookie = (email, exp = Date.now() + 60000) => `scv_sso=${sso.sign({ email, name: '시험', exp }, 'test-secret')}`;

let server, url;
test.before(() => new Promise((ok) => { server = app.listen(0, '127.0.0.1', () => { url = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

test('통합 로그인 쿠키 확인', () => {
  const raw = sso.sign({ email: 'a@example.org', exp: Date.now() + 1000 }, 'k');
  assert.equal(sso.verify(raw, 'k', 'example.org').email, 'a@example.org');
  assert.equal(sso.verify(raw, 'other', 'example.org'), null, '다른 비밀값');
  assert.equal(sso.verify(sso.sign({ email: 'a@gmail.com', exp: Date.now() + 1000 }, 'k'), 'k', 'example.org'), null, '외부 메일');
  assert.equal(sso.verify(sso.sign({ email: 'a@example.org', exp: Date.now() - 1 }, 'k'), 'k', 'example.org'), null, '만료');
});

test('계산: 사용기간·내용연수·금액', () => {
  assert.equal(calc.usePeriod('2020-03-15', '2026-03-14'), '5년 11개월');
  assert.equal(calc.usePeriod('2020-03-15', '2026-03-15'), '6년 0개월');
  assert.equal(calc.lifeState('2021-01-01', 5, '2026-01-01'), '도래');
  assert.equal(calc.lifeState('2021-01-02', 5, '2026-01-01'), '미도래');
  assert.equal(assets.clean({ name: 'x', qty: '2', unit_price: '1,500원' }).amount, 3000);
});

test('관리번호 자동·변동 이력·불용·복구', () => {
  const a = assets.create({ name: '노트북', purchase_date: '2026-02-01', location: '2층', holder: '갑' }, 't');
  const b = assets.create({ name: '모니터', purchase_date: '2026-03-01' }, 't');
  assert.equal(a, 'S2026-001');
  assert.equal(b, 'S2026-002');
  assert.throws(() => assets.create({ name: 'x' }, 't', 'S2026-001'), /이미/);
  assets.update(a, { location: '3층' }, 't');
  const h = assets.history(a);
  assert.equal(h.length, 1);
  assert.equal(h[0].prev_location, '2층');
  assert.match(h[0].changes, /현재위치: 2층 → 3층/);
  assert.equal(assets.update(a, { location: '3층' }, 't'), '', '바뀐 것 없으면 기록 없음');
  assets.setDisused(a, { grade: 'B', reason: '고장' }, 't');
  assert.equal(calc.status(assets.get(a)), '불용');
  assert.ok(assets.disposal(a));
  assets.restore(a, 't');
  assert.equal(calc.status(assets.get(a)), '사용중');
  assert.equal(assets.disposal(a), undefined, '복구하면 불용물품 줄 삭제');
  assert.throws(() => assets.discard(a, '2026-05-01', '', 't'), /불용/);
});

test('재물조사: 변동 있으면 자산 갱신·이력', () => {
  const id = assets.create({ name: '책상', purchase_date: '2025-01-01', location: 'A', holder: '을', dept: '운영' }, 't');
  const sid = surveys.start('시험 조사', 't');
  surveys.check(sid, id, { remark: '' }, 't');
  assert.equal(assets.history(id).length, 0);
  surveys.check(sid, id, { remark: '옮김', changed: true, location: 'B', holder: '을', dept: '운영' }, 't');
  assert.equal(assets.get(id).location, 'B');
  assert.equal(assets.history(id)[0].reason, '재물조사');
  assert.equal(surveys.progress(sid).filter((r) => r.checked_at).length, 1, '다시 찍으면 덮어쓴다');
  assert.equal(assets.find(id.toLowerCase()).id, id);
});

test('로그인 없으면 통합 로그인으로 보낸다', async () => {
  const r = await fetch(url + '/', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/settings\/login\?next=/);
  const p = await fetch(url + '/new', { method: 'POST', redirect: 'manual' });
  assert.equal(p.status, 401);
});

test('화면이 열린다', async () => {
  const h = { cookie: cookie('staff@example.org') };
  for (const u of ['/', '/new', '/a/S2026-001', '/survey', '/survey/scan', '/survey/check?code=S2026-001', '/labels',
    '/labels/print?mode=all', '/disposals', '/history', '/options', '/a/S2026-001/qr.svg']) {
    const r = await fetch(url + u, { headers: h });
    assert.equal(r.status, 200, u);
  }
});

test('다른 사이트 POST 차단·삭제는 관리자만', async () => {
  const staff = { cookie: cookie('staff@example.org'), 'content-type': 'application/x-www-form-urlencoded' };
  const bad = await fetch(url + '/new', { method: 'POST', headers: { ...staff, origin: 'https://evil.example' }, body: 'name=x' });
  assert.equal(bad.status, 403);
  const del = await fetch(url + '/a/S2026-002/delete', { method: 'POST', headers: staff, body: 'confirm=S2026-002', redirect: 'manual' });
  assert.equal(del.status, 403);
  assert.ok(assets.get('S2026-002'));
  const boss = { ...staff, cookie: cookie('boss@example.org') };
  const ok = await fetch(url + '/a/S2026-002/delete', { method: 'POST', headers: boss, body: 'confirm=S2026-002', redirect: 'manual' });
  assert.equal(ok.status, 303);
  assert.equal(assets.get('S2026-002'), undefined);
});

test('직원 등록 POST', async () => {
  const r = await fetch(url + '/new', {
    method: 'POST', redirect: 'manual',
    headers: { cookie: cookie('staff@example.org'), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id: 'S2024-010', name: '의자', qty: '3', unit_price: '10000', purchase_date: '2024-05-05' }).toString(),
  });
  assert.equal(r.status, 303);
  const a = assets.get('S2024-010');
  assert.equal(a.amount, 30000);
  assert.equal(a.updated_by, 'staff@example.org');
});

test('직원 명부·관리 권한', async () => {
  const staff = require('../src/models/staff');
  const { execFileSync } = require('child_process');
  const tsv = 'email\tname\tdept\tposition\tstatus\nstaff@example.org\t직원\t운영지원팀\t사원\tactive\n' +
    'gone@example.org\t퇴사자\t운영지원팀\t사원\tretired\nmate@example.org\t동료\t취업지원팀\t주임\tleave\noutside@gmail.com\t외부\t\t\tactive\n';
  const out = execFileSync(process.execPath, ['scripts/sync-staff.js'], { input: tsv, env: process.env }).toString();
  assert.match(out, /3명/, '기관 메일만 받는다');
  assert.equal(staff.count(), 3);
  const get = (email) => fetch(url + '/', { headers: { cookie: cookie(email) }, redirect: 'manual' });
  assert.equal((await get('staff@example.org')).status, 200);
  assert.equal((await get('mate@example.org')).status, 200, '휴직은 들어옴');
  assert.equal((await get('gone@example.org')).status, 403, '퇴사는 막음');
  assert.equal((await get('nobody@example.org')).status, 403, '명부에 없으면 막음');
  assert.equal((await get('boss@example.org')).status, 200, 'ADMINS 는 명부 없어도');

  const post = (as, body) => fetch(url + '/permissions', { method: 'POST', redirect: 'manual',
    headers: { cookie: cookie(as), 'content-type': 'application/x-www-form-urlencoded' }, body });
  assert.equal((await post('staff@example.org', 'email=staff%40example.org&on=1')).status, 403, '일반 직원은 권한 못 줌');
  assert.equal(staff.isAdmin('staff@example.org'), false);
  assert.equal((await post('boss@example.org', 'email=staff%40example.org&on=1')).status, 303);
  assert.equal(staff.isAdmin('staff@example.org'), true);
  assert.equal((await fetch(url + '/permissions', { headers: { cookie: cookie('staff@example.org') } })).status, 200);
  staff.grant('gone@example.org', 't');
  assert.equal(staff.isAdmin('gone@example.org'), false, '퇴사자는 권한 효력 없음');
  await post('boss@example.org', 'email=staff%40example.org&on=0');
  assert.equal(staff.isAdmin('staff@example.org'), false);
  assert.throws(() => staff.grant('nobody@example.org', 't'), /명부/);
  assert.throws(() => execFileSync(process.execPath, ['scripts/sync-staff.js'], { input: 'email\n', env: process.env, stdio: 'pipe' }), '빈 명부는 거부');
  assert.equal(staff.count(), 3, '빈 명부가 와도 기존 명부 유지');
});
