// 설정은 모두 환경변수(.env)에서 읽는다. 운영본과 시연판(브라우저)이 같은 코드를 쓰고 이 값만 다르다.
require('dotenv').config();
const path = require('path');

const root = path.join(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 5214),
  host: process.env.HOST || '127.0.0.1',
  // 앱이 붙는 주소 경로. 예: https://example.org/items/ → '/items'
  base: (process.env.BASE_PATH || '').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  // sso = 통합 로그인 쿠키(scv_sso) 필수 — 형식은 src/lib/sso.js / none = 로그인 없음(개발·시연판)
  authMode: process.env.AUTH_MODE || 'sso',
  ssoSecret: process.env.SCV_SSO_SECRET || '',
  ssoLogin: process.env.SSO_LOGIN_URL || '/settings/login',
  staffDomain: process.env.STAFF_EMAIL_DOMAIN || 'example.org',
  // 자산 삭제·목록값 관리를 할 수 있는 사람(이메일, 쉼표). 비우면 직원 누구나.
  admins: (process.env.ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  orgName: process.env.ORG_NAME || '우리 기관',
  demo: process.env.APP_MODE === 'demo',
};
