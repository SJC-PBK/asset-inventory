// 통합 로그인 쿠키(scv_sso) 확인. 로그인 창구(별도 프로그램)가 아래 형식으로 서명해 같은 도메인에 쿠키를 둔다.
// base64url(JSON{email,name,exp(ms)}) . base64url(HMAC-SHA256(SCV_SSO_SECRET, 'scv_sso' + 앞부분))
const crypto = require('crypto');

const NAME = 'scv_sso';

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 검증된 { email, name } 또는 null
function verify(raw, secret, domain, now = Date.now()) {
  if (!secret || !raw || raw.split('.').length !== 2) return null;
  const [v, s] = raw.split('.');
  const want = b64url(crypto.createHmac('sha256', secret).update(NAME + v).digest());
  if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  let o;
  try {
    o = JSON.parse(Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
  if (!o || typeof o.exp !== 'number' || o.exp <= now) return null;
  const email = String(o.email || '').toLowerCase();
  if (!email.endsWith('@' + domain)) return null;
  return { email, name: String(o.name || '') || email.split('@')[0] };
}

// 시험용: 쿠키 값 만들기
function sign(payload, secret) {
  const v = b64url(JSON.stringify(payload));
  return v + '.' + b64url(crypto.createHmac('sha256', secret).update(NAME + v).digest());
}

module.exports = { NAME, readCookie, verify, sign };
