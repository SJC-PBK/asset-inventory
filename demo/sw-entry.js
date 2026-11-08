// 재물관리대장 시연판 — 서비스 워커.
// 실제 앱(src/server.js 와 라우트·모델·화면 템플릿)을 방문자 브라우저 안에서 그대로 돌린다.
// 서버·DB 서버 없음. 자료는 지어낸 것이고, 고친 내용은 이 브라우저 IndexedDB 에만 남는다.
//
//   <BASE>            안내 페이지(index.html) — 실제 파일
//   <BASE>files/      앱의 public/ · jsQR · sql.js · 첫 DB — 실제 파일
//   <BASE>app/...     앱 화면 — 이 워커가 만든다 (앱은 BASE_PATH=<BASE>app 으로 링크를 만든다)
/* global BUILD_ID */
const initSqlJs = require('sql.js/dist/sql-wasm.js');
const Database = require('better-sqlite3');
const fs = require('fs');
const express = require('express');
const qs = require('qs');

const BASE = new URL(self.registration.scope).pathname;
const APP = BASE + 'app';
const FILES = BASE + 'files/';
process.env.BASE_PATH = APP; // config.js 가 읽기 전에

function idb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('itemmanager-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((ok, no) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => ok(req && req.result);
    tx.onerror = () => no(tx.error);
  });
}
const idbGet = (k) => idbDo('readonly', (s) => s.get(k));
const idbPut = (k, v) => idbDo('readwrite', (s) => s.put(v, k));
const idbDel = (k) => idbDo('readwrite', (s) => s.delete(k));

let SQL = null;
let app = null;
let booting = null;

async function seedBytes() {
  const r = await fetch(FILES + 'seed.bin?v=' + BUILD_ID, { cache: 'no-cache' });
  if (!r.ok) throw new Error('첫 자료를 받지 못했습니다 (' + r.status + ')');
  return new Uint8Array(await r.arrayBuffer());
}

function boot() {
  if (!booting) {
    booting = (async () => {
      SQL = await initSqlJs({ locateFile: () => FILES + 'sql-wasm.wasm?v=' + BUILD_ID });
      const saved = await idbGet('state').catch(() => null);
      let bytes;
      if (saved && saved.ver === BUILD_ID) {
        bytes = saved.db;
        fs.__restore(saved.files);
      } else {
        bytes = await seedBytes();
      }
      Database.__demo.setDatabase(new SQL.Database(bytes));
      app = require('../src/server.js');
    })().catch((e) => {
      booting = null;
      throw e;
    });
  }
  return booting;
}

async function persist(force) {
  if (!force && !Database.__demo.state.dirty) return;
  await idbPut('state', { ver: BUILD_ID, db: Database.__demo.exportBytes(), files: fs.__written() });
}

async function resetAll() {
  await boot();
  await idbDel('state');
  fs.__resetWritten();
  Database.__demo.setDatabase(new SQL.Database(await seedBytes()));
  await persist(true);
}

function badge() {
  return `<a href="${BASE}" style="position:fixed;right:8px;bottom:8px;z-index:2147483647;` +
    `background:#1f2937;color:#fff;font:600 13px/1 system-ui,sans-serif;padding:8px 12px;` +
    `border-radius:999px;text-decoration:none;opacity:.85" aria-label="시연판 안내로 돌아가기">시연판 · 처음으로</a>`;
}

async function readBody(request, ct) {
  const files = {};
  if (request.method === 'GET' || request.method === 'HEAD') return { body: {}, files };
  if (ct.includes('multipart/form-data')) {
    const fd = await request.formData();
    const usp = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') usp.append(k, v);
      else files[k] = { name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) };
    }
    return { body: qs.parse(usp.toString()), files };
  }
  return { body: qs.parse(await request.text()), files };
}

async function handle(request, appUrl) {
  // 시연용 예시 사진은 홈페이지에 올린 파일 그대로(목록은 작은 판) — 앱·DB 를 거치지 않는다
  const demoPhoto = /^\/photos\/demo-([a-z]+)\.jpg(\?thumb=1)?$/.exec(appUrl);
  if (demoPhoto) return fetch(FILES + 'photos/' + (demoPhoto[2] ? 'thumb/' : '') + demoPhoto[1] + '.jpg');
  await boot();
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  headers.host = self.location.host; // 앱의 같은-출처 검사용(워커 요청에는 host 가 없다)
  const { body, files } = await readBody(request, headers['content-type'] || '');
  const req = express.__makeReq({ method: request.method, url: appUrl, headers, body, files, session: {} });
  const res = await new Promise((resolve) => app(req, express.__makeRes(req, resolve)));

  if (res.__network) return fetch(FILES + 'public' + res.__network);
  const h = new Headers();
  Object.keys(res.headers).forEach((k) => h.set(k, res.headers[k]));
  let out = res.body;
  if (typeof out === 'string' && (h.get('content-type') || '').startsWith('text/html')) out = out.replace(/<\/body>/i, badge() + '</body>');
  h.set('cache-control', 'no-store');
  const status = res.statusCode;
  const nullBody = status === 204 || status === 304 || (status >= 300 && status < 400) || request.method === 'HEAD';
  return new Response(nullBody ? null : out, { status, headers: h });
}

function errorPage(e) {
  const msg = String((e && e.message) || e).replace(/[<&>]/g, '');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>시연판 오류</title><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.6">` +
      `<h1>시연판을 열지 못했습니다</h1><p>${msg}</p><p><a href="${BASE}">안내 페이지로 돌아가기</a></p>`,
    { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (!(p === APP || p.startsWith(APP + '/'))) return; // 안내 페이지·실제 파일
  const appPath = p.slice(APP.length) || '/';
  e.respondWith(
    handle(e.request, appPath + url.search)
      .then((r) => {
        e.waitUntil(persist().catch((err) => console.error('[시연판] 저장 실패', err)));
        return r;
      })
      .catch((err) => {
        console.error('[시연판]', err);
        return errorPage(err);
      })
  );
});

self.addEventListener('message', (e) => {
  const d = e.data || {};
  const reply = (m) => e.source && e.source.postMessage(m);
  if (d.type === 'reset') {
    e.waitUntil(resetAll().then(() => reply({ type: 'reset-done' }), (err) => reply({ type: 'reset-failed', error: String(err && err.message) })));
  } else if (d.type === 'warm') {
    e.waitUntil(boot().then(() => reply({ type: 'ready' }), (err) => reply({ type: 'boot-failed', error: String(err && err.message) })));
  }
});
