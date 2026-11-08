const config = require('../config');

// 앱 안 주소로 이동(+ 알림 한 줄)
module.exports = function go(res, to, { msg, err } = {}) {
  const q = msg ? `msg=${encodeURIComponent(msg)}` : err ? `err=${encodeURIComponent(err)}` : '';
  res.redirect(303, config.base + to + (q ? (to.includes('?') ? '&' : '?') + q : ''));
};
