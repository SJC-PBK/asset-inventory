const config = require('../config');
const sso = require('../lib/sso');
const staff = require('../models/staff');

// 로그인 확인. sso 모드는 통합 로그인 쿠키, none 모드(개발·시연판)는 누구나.
function auth(req, res, next) {
  if (config.authMode === 'none') {
    req.user = { email: 'demo@' + config.staffDomain, name: config.demo ? '시연 사용자' : '개발자' };
  } else {
    req.user = sso.verify(sso.readCookie(req.headers.cookie, sso.NAME), config.ssoSecret, config.staffDomain);
    if (!req.user) {
      if (req.method === 'GET') {
        return res.redirect(`${config.ssoLogin}?next=${encodeURIComponent(config.base + req.originalUrl)}`);
      }
      return res.status(401).send('로그인이 끊겼습니다. 화면을 새로 고쳐 다시 로그인해 주세요.');
    }
  }
  if (config.authMode !== 'none') {
    if (!staff.canEnter(req.user.email)) {
      return res.status(403).render('message', { user: req.user, title: '들어갈 수 없음',
        text: `${req.user.email} 은 직원 명부에 없거나 퇴사 처리된 계정입니다. 필요하면 관리자에게 알려 주세요.` });
    }
    const s = staff.get(req.user.email);
    if (s && s.name) req.user.name = s.name;
    req.user.admin = staff.isAdmin(req.user.email);
  } else {
    req.user.admin = true; // 개발·시연판
  }
  res.locals.user = req.user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.admin) return next();
  res.status(403).render('message', { title: '권한 없음', text: '관리자만 할 수 있는 일입니다.' });
}

// 다른 사이트에서 보낸 POST 를 막는다(쿠키는 SameSite=Lax 라 1차로 막히고, 이건 2차)
function sameOrigin(req, res, next) {
  if (req.method !== 'POST') return next();
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return next();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    if (new URL(origin).host === host) return next();
  } catch { /* 아래로 */ }
  res.status(403).send('허용되지 않은 요청입니다.');
}

module.exports = { auth, adminOnly, sameOrigin };
