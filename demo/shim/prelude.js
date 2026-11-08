// 브라우저 시연판용 대체 부품.
// 서비스 워커에 없는 Node 전역값(Buffer·process·setImmediate) — build.mjs 가 inject 한다.
import { Buffer as B } from 'buffer';

// buffer@6 은 'base64url' 을 모른다. 앱의 CSRF 토큰이 이것을 쓴다.
const origToString = B.prototype.toString;
B.prototype.toString = function toString(enc, ...rest) {
  if (enc === 'base64url') {
    return origToString.call(this, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return origToString.call(this, enc, ...rest);
};

export const Buffer = B;
// versions.node 를 두지 않는다 — sql.js 가 Node 로 착각해 fs 를 부른다.
export const process = {
  env: JSON.parse(DEMO_ENV),
  argv: [],
  versions: {},
  platform: 'browser',
  cwd: () => '/app',
  nextTick: (f, ...a) => queueMicrotask(() => f(...a)),
  on() {},
  emitWarning() {},
  exit() {},
  stdout: { write() {} },
  stderr: { write() {} },
};
export const setImmediate = (f, ...a) => setTimeout(f, 0, ...a);
export const clearImmediate = (t) => clearTimeout(t);
