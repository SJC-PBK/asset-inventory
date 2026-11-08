const express = require('express');
const qrSvg = require('../lib/qr');
const db = require('../db');
const assets = require('../models/assets');
const go = require('../lib/go');

const router = express.Router();

// 폼텍 3218: 63.5 x 45 mm, 3열 x 6행, 위 10mm, 왼쪽 7.2mm, 가로 간격 66mm (GAS alllebel.js 와 같은 치수)
const SHEET = { cols: 3, rows: 6, w: 63.5, h: 45, top: 10, left: 7.2, pitchX: 66, pitchY: 45 };

function pick(mode, ids) {
  if (mode === 'marked') return db.prepare("SELECT * FROM assets WHERE label_mark = 1 AND disused = 0 AND discard_date = '' ORDER BY id").all();
  if (mode === 'ids') {
    const want = [...new Set(String(ids || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
    return want.map((id) => assets.find(id)).filter(Boolean);
  }
  return db.prepare("SELECT * FROM assets WHERE disused = 0 AND discard_date = '' ORDER BY id").all();
}

router.get('/labels', (req, res) => {
  const count = (m) => pick(m).length;
  res.render('labels', { all: count('all'), marked: count('marked'), ids: String(req.query.ids || '') });
});

router.get('/labels/print', (req, res, next) => {
  try {
    const mode = String(req.query.mode || 'all');
    const rows = pick(mode, req.query.ids);
    if (!rows.length) return go(res, '/labels', { err: '인쇄할 자산이 없습니다.' });
    const skip = Math.max(0, Math.min(SHEET.cols * SHEET.rows - 1, parseInt(req.query.skip, 10) || 0));
    const items = [];
    for (const a of rows) items.push({ a, qr: qrSvg(a.id) });
    const cells = [...Array(skip).fill(null), ...items];
    const per = SHEET.cols * SHEET.rows;
    const pages = [];
    for (let i = 0; i < cells.length; i += per) pages.push(cells.slice(i, i + per));
    res.render('labels-print', { pages, S: SHEET, count: items.length, mode });
  } catch (e) { next(e); }
});

// 인쇄 뒤 '라벨' 표시 지우기(유지보수 라벨)
router.post('/labels/clear-marks', (req, res) => {
  const n = db.prepare('UPDATE assets SET label_mark = 0 WHERE label_mark = 1').run().changes;
  go(res, '/labels', { msg: `라벨 표시 ${n}건을 지웠습니다.` });
});

module.exports = router;
