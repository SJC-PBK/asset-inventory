const express = require('express');
const assets = require('../models/assets');
const options = require('../models/options');
const surveys = require('../models/surveys');
const go = require('../lib/go');

const router = express.Router();

// 라벨 QR 에는 관리번호만 들어 있다. 혹시 주소가 찍힌 QR 이면 끝 부분을 쓴다.
function codeOf(raw) {
  let s = String(raw || '').trim();
  const m = /\/a\/([^/?#]+)/.exec(s);
  if (m) s = decodeURIComponent(m[1]);
  return s;
}

function view(res, survey) {
  const rows = surveys.progress(survey.id);
  const done = rows.filter((r) => r.checked_at);
  res.render('survey', { survey, rows, done: done.length, total: rows.length, changed: done.filter((r) => r.changed).length, rounds: surveys.list() });
}

router.get('/survey', (req, res) => {
  const survey = surveys.current();
  if (!survey) return res.render('survey-start', { rounds: surveys.list() });
  view(res, survey);
});

router.get('/survey/round/:sid', (req, res) => {
  const survey = surveys.get(Number(req.params.sid));
  if (!survey) return go(res, '/survey');
  view(res, survey);
});

router.post('/survey/start', (req, res) => {
  const title = String(req.body.title || '').trim() || `${new Date().getFullYear()}년 재물조사`;
  surveys.start(title, req.user.email);
  go(res, '/survey', { msg: `'${title}' 조사를 시작했습니다.` });
});

router.post('/survey/round/:sid/close', (req, res) => {
  surveys.close(Number(req.params.sid));
  go(res, '/survey', { msg: '조사를 마쳤습니다. 기록은 지난 조사에 남아 있습니다.' });
});

router.get('/survey/scan', (req, res) => {
  const survey = surveys.current();
  if (!survey) return go(res, '/survey', { err: '먼저 조사를 시작해 주세요.' });
  res.render('scan', { survey });
});

router.get('/survey/check', (req, res) => {
  const survey = surveys.current();
  if (!survey) return go(res, '/survey', { err: '먼저 조사를 시작해 주세요.' });
  const id = codeOf(req.query.code);
  const a = assets.find(id);
  if (!a) return go(res, '/survey/scan', { err: `'${id || '(빈 값)'}' 자산을 찾지 못했습니다. 관리번호를 확인해 주세요.` });
  res.render('check', { survey, a, prev: surveys.checkOf(survey.id, a.id), opts: options.all() });
});

router.post('/survey/check', (req, res) => {
  const survey = surveys.current();
  if (!survey) return go(res, '/survey', { err: '열려 있는 조사가 없습니다.' });
  const a = assets.find(codeOf(req.body.id));
  const id = a ? a.id : codeOf(req.body.id);
  try {
    surveys.check(survey.id, id, { ...req.body, changed: req.body.changed === '1' }, req.user.email);
    if (req.body.changed === '1') {
      options.remember('location', req.body.location);
      options.remember('holder', req.body.holder);
      options.remember('dept', req.body.dept);
    }
    go(res, req.body.back === 'list' ? '/survey' : '/survey/scan', { msg: `${id} 조사 완료${req.body.changed === '1' ? ' (변동 반영)' : ''}` });
  } catch (e) {
    go(res, '/survey/scan', { err: e.message });
  }
});

module.exports = router;
module.exports.codeOf = codeOf;
