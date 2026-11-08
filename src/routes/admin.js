const express = require('express');
const options = require('../models/options');
const staff = require('../models/staff');
const go = require('../lib/go');
const { adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/options', (req, res) => res.render('options', { kinds: options.KINDS, opts: options.all() }));

router.post('/options', adminOnly, (req, res) => {
  try {
    const n = options.replace(req.body.kind, req.body.values);
    go(res, '/options', { msg: `${options.KINDS[req.body.kind]} 목록 ${n}개를 저장했습니다.` });
  } catch (e) {
    go(res, '/options', { err: e.message });
  }
});

// 관리 권한: 직원 명부에서 골라 준다
router.get('/permissions', adminOnly, (req, res) => {
  res.render('permissions', { rows: staff.list(), lastSync: staff.lastSync(), fixed: res.locals.config.admins, STATUS: staff.STATUS });
});

router.post('/permissions', adminOnly, (req, res) => {
  const email = String(req.body.email || '').toLowerCase();
  try {
    if (req.body.on === '1') {
      staff.grant(email, req.user.email);
      go(res, '/permissions', { msg: `${email} 에게 관리 권한을 줬습니다.` });
    } else {
      if (email === req.user.email) throw new Error('자기 권한은 스스로 뺄 수 없습니다.');
      staff.revoke(email);
      go(res, '/permissions', { msg: `${email} 의 관리 권한을 뺐습니다.` });
    }
  } catch (e) {
    go(res, '/permissions', { err: e.message });
  }
});

module.exports = router;
