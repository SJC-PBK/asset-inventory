// 브라우저 시연판용 대체 부품.
// fs 흉내 — 브라우저 안 가상 파일.
// 빌드 때 넣은 읽기 전용 파일(화면 템플릿·스키마·매뉴얼·아이콘)과
// 시연 중 생기는 파일(올린 메뉴 사진·초기화 백업)을 한 지도에 둔다.
// 시연 중 생긴 파일은 sw-entry.js 가 IndexedDB 에 함께 저장한다.
/* global __DEMO_FILES__ */
const path = require('path');

const files = new Map();   // 경로 → Uint8Array | string
const dirs = new Set(['/']);
const written = new Set(); // 시연 중 쓴 파일 — 저장 대상

function addDirs(p) {
  let d = path.dirname(p);
  while (d && !dirs.has(d)) {
    dirs.add(d);
    d = path.dirname(d);
  }
}

function load(map) {
  Object.keys(map).forEach((p) => {
    files.set(p, map[p]);
    addDirs(p);
  });
}
load(typeof __DEMO_FILES__ !== 'undefined' ? __DEMO_FILES__ : {});

function enoent(p) {
  const e = new Error("ENOENT: no such file or directory, '" + p + "'");
  e.code = 'ENOENT';
  return e;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBytes(v) {
  return typeof v === 'string' ? enc.encode(v) : v;
}

const fs = {
  existsSync(p) {
    p = path.resolve(p);
    return files.has(p) || dirs.has(p);
  },
  statSync(p) {
    p = path.resolve(p);
    if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false, size: 0, mtime: new Date() };
    if (!files.has(p)) throw enoent(p);
    const v = files.get(p);
    return { isDirectory: () => false, isFile: () => true, size: toBytes(v).length, mtime: new Date() };
  },
  readFileSync(p, opt) {
    p = path.resolve(String(p));
    if (!files.has(p)) throw enoent(p);
    const v = files.get(p);
    const encoding = typeof opt === 'string' ? opt : opt && opt.encoding;
    if (encoding) return typeof v === 'string' ? v : dec.decode(v);
    return Buffer.from(toBytes(v));
  },
  writeFileSync(p, data) {
    p = path.resolve(String(p));
    files.set(p, typeof data === 'string' ? data : new Uint8Array(data));
    written.add(p);
    addDirs(p);
  },
  copyFileSync(a, b) {
    fs.writeFileSync(b, toBytes(files.get(path.resolve(a)) || (() => { throw enoent(a); })()));
  },
  unlinkSync(p) {
    p = path.resolve(String(p));
    if (!files.has(p)) throw enoent(p);
    files.delete(p);
    written.add(p);
  },
  mkdirSync(p) {
    dirs.add(path.resolve(String(p)));
    addDirs(path.resolve(String(p)) + '/x');
  },
  readdirSync(p) {
    p = path.resolve(String(p));
    const out = new Set();
    const pre = p === '/' ? '/' : p + '/';
    for (const k of files.keys()) if (k.startsWith(pre)) out.add(k.slice(pre.length).split('/')[0]);
    for (const k of dirs) if (k.startsWith(pre) && k !== p) out.add(k.slice(pre.length).split('/')[0]);
    return [...out];
  },
  readFile(p, opt, cb) {
    if (typeof opt === 'function') {
      cb = opt;
      opt = undefined;
    }
    try {
      const v = fs.readFileSync(p, opt);
      queueMicrotask(() => cb(null, v));
    } catch (e) {
      queueMicrotask(() => cb(e));
    }
  },
  // ---- sw-entry.js 가 저장·되살릴 때 쓴다 ----
  __written() {
    const out = {};
    written.forEach((p) => {
      out[p] = files.has(p) ? toBytes(files.get(p)) : null;
    });
    return out;
  },
  __restore(map) {
    Object.keys(map || {}).forEach((p) => {
      if (map[p] === null) files.delete(p);
      else {
        files.set(p, map[p]);
        addDirs(p);
      }
      written.add(p);
    });
  },
  __resetWritten() {
    written.forEach((p) => {
      if (p.startsWith('/app/data/')) files.delete(p);
    });
    written.clear();
  },
};

fs.promises = {
  unlink: async (p) => fs.unlinkSync(p),
  readFile: async (p, o) => fs.readFileSync(p, o),
  writeFile: async (p, d) => fs.writeFileSync(p, d),
  mkdir: async (p) => fs.mkdirSync(p),
};

module.exports = fs;
