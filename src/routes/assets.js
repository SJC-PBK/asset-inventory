const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const qrSvg = require('../lib/qr');
const config = require('../config');
const assets = require('../models/assets');
const options = require('../models/options');
const surveys = require('../models/surveys');
const go = require('../lib/go');
const { today } = require('../lib/calc');
const { adminOnly } = require('../middleware/auth');

const router = express.Router();
const photoDir = path.join(config.dataDir, 'photos');
const enc = encodeURIComponent;

const upload = multer({
  storage: multer.diskStorage({
    destination: photoDir,
    filename: (req, file, cb) => cb(null, `${req.params.id.replace(/[^\w-]/g, '_')}-${Date.now()}.jpg`),
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

function rememberOptions(a) {
  options.remember('location', a.location);
  options.remember('holder', a.holder);
  options.remember('dept', a.dept);
  options.remember('category', a.category);
}

router.get('/', (req, res) => {
  const f = {
    q: String(req.query.q || '').trim(), dept: String(req.query.dept || ''),
    location: String(req.query.location || ''), state: String(req.query.state || 'active'),
  };
  const survey = surveys.current();
  const checked = new Set();
  if (survey) for (const r of surveys.progress(survey.id)) if (r.checked_at) checked.add(r.id);
  res.render('list', { f, rows: assets.list(f), opts: options.all(), stats: assets.stats(), survey, checked });
});

router.get('/new', (req, res) => {
  const a = { purchase_date: today(), qty: 1 };
  res.render('form', { a, isNew: true, suggestId: assets.nextId(a.purchase_date), opts: options.all() });
});

router.get('/next-id', (req, res) => res.type('text').send(assets.nextId(String(req.query.date || ''))));

router.post('/new', (req, res) => {
  try {
    const id = assets.create(req.body, req.user.email, req.body.id);
    rememberOptions(assets.get(id));
    go(res, `/a/${enc(id)}`, { msg: `${id} 등록했습니다.` });
  } catch (e) {
    res.status(400).render('form', { a: req.body, isNew: true, suggestId: req.body.id, opts: options.all(), error: e.message });
  }
});

function load(req, res, next) {
  req.asset = assets.get(req.params.id);
  if (!req.asset) return res.status(404).render('message', { title: '찾을 수 없음', text: `관리번호 ${req.params.id} 자산이 없습니다.` });
  next();
}

router.get('/a/:id', load, (req, res) => {
  const a = req.asset;
  const survey = surveys.current();
  res.render('detail', {
    a, history: assets.history(a.id), disposal: assets.disposal(a.id), checks: surveys.checksOfAsset(a.id),
    survey, surveyCheck: survey && surveys.checkOf(survey.id, a.id),
  });
});

router.get('/a/:id/edit', load, (req, res) => res.render('form', { a: req.asset, isNew: false, opts: options.all() }));

router.post('/a/:id/edit', load, (req, res) => {
  try {
    let id = req.asset.id;
    const changes = assets.update(id, req.body, req.user.email);
    if (req.body.id && req.body.id.trim() !== id) id = assets.rename(id, req.body.id, req.user.email);
    rememberOptions(assets.get(id));
    go(res, `/a/${enc(id)}`, { msg: changes || id !== req.asset.id ? '저장했습니다. 바뀌기 전 내용은 변동 이력에 남겼습니다.' : '바뀐 내용이 없습니다.' });
  } catch (e) {
    res.status(400).render('form', { a: { ...req.asset, ...req.body, id: req.asset.id }, isNew: false, opts: options.all(), error: e.message });
  }
});

router.post('/a/:id/delete', load, adminOnly, (req, res) => {
  if (req.body.confirm !== req.asset.id) return go(res, `/a/${enc(req.asset.id)}`, { err: '확인 칸에 관리번호를 똑같이 적어야 삭제됩니다.' });
  assets.remove(req.asset.id);
  go(res, '/', { msg: `${req.asset.id} 를 삭제했습니다.` });
});

router.post('/a/:id/photo', load, upload.single('photo'), (req, res) => {
  if (!req.file) return go(res, `/a/${enc(req.asset.id)}`, { err: '사진(jpg·png·webp, 12MB 이하)을 골라 주세요.' });
  const old = req.asset.photo;
  assets.setPhoto(req.asset.id, req.file.filename, req.user.email);
  if (old && old !== req.file.filename) try { fs.unlinkSync(path.join(photoDir, path.basename(old))); } catch { /* 이미 없음 */ }
  go(res, `/a/${enc(req.asset.id)}`, { msg: '사진을 바꿨습니다.' });
});

router.post('/a/:id/label', load, (req, res) => {
  assets.update(req.asset.id, { label_mark: req.body.on === '1' ? 1 : 0 }, req.user.email);
  go(res, `/a/${enc(req.asset.id)}`, { msg: req.body.on === '1' ? '라벨 인쇄 대상에 넣었습니다.' : '라벨 인쇄 대상에서 뺐습니다.' });
});

router.get('/a/:id/qr.svg', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'private, max-age=86400').send(qrSvg(req.params.id));
});

router.get('/photos/:file', (req, res) => {
  const file = path.basename(req.params.file);
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(photoDir, file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// ── 불용 ─────────────────────────────────────────────
router.get('/a/:id/disuse', load, (req, res) => {
  res.render('disuse', { a: req.asset, d: assets.disposal(req.asset.id) || { decided_on: today(), processed_on: today(), place: req.asset.location } });
});

router.post('/a/:id/disuse', load, (req, res) => {
  const first = !req.asset.disused;
  assets.setDisused(req.asset.id, req.body, req.user.email);
  go(res, `/a/${enc(req.asset.id)}`, { msg: first ? '불용 처리했습니다.' : '불용 정보를 고쳤습니다.' });
});

router.post('/a/:id/restore', load, (req, res) => {
  assets.restore(req.asset.id, req.user.email);
  go(res, `/a/${enc(req.asset.id)}`, { msg: '불용을 풀고 사용 중으로 되돌렸습니다.' });
});

router.post('/a/:id/discard', load, (req, res) => {
  try {
    assets.discard(req.asset.id, req.body.discard_date, req.body.discard_reason, req.user.email);
    go(res, `/a/${enc(req.asset.id)}`, { msg: '폐기 완료로 바꿨습니다.' });
  } catch (e) {
    go(res, `/a/${enc(req.asset.id)}/disuse`, { err: e.message });
  }
});

router.get('/disposals', (req, res) => res.render('disposals', { rows: assets.disposals() }));
router.get('/history', (req, res) => res.render('history', { rows: assets.allHistory() }));

module.exports = router;
