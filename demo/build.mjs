// 재물관리대장 시연판 빌드 — 결과는 demo/dist/ (정적 파일만: 홈페이지·버셀 등 어디에나 올릴 수 있다)
//   cd demo && npm ci && npm run build
//
//   dist/index.html   안내 페이지 (shell/index.html)
//   dist/sw.js        서비스 워커 = 앱 전체(라우트·모델·화면) + 대체 부품(shim/)
//   dist/files/       public/ 사본 · jsQR · sql-wasm.wasm · seed.bin(시연용 첫 DB — 지어낸 자료)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(HERE, 'dist');
const VROOT = '/app';

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'files'), { recursive: true });

// 1) 첫 DB — scripts/seed-demo.js 의 지어낸 자료. 실제 자산 자료는 절대 쓰지 않는다.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itemmgr-demo-'));
execFileSync(process.execPath, ['-e', `
  const seed = require('./scripts/seed-demo.js'); seed({ force: true });
  const db = require('./src/db'); db.pragma('journal_mode = DELETE'); db.close();`], {
  cwd: ROOT, env: { ...process.env, DATA_DIR: tmp }, stdio: 'inherit',
});
const seed = fs.readFileSync(path.join(tmp, 'itemmanager.db'));
fs.writeFileSync(path.join(DIST, 'files', 'seed.bin'), seed);
fs.rmSync(tmp, { recursive: true, force: true });

// 2) 정적 파일
fs.cpSync(path.join(ROOT, 'public'), path.join(DIST, 'files', 'public'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'node_modules/sql.js/dist/sql-wasm.wasm'), path.join(DIST, 'files', 'sql-wasm.wasm'));
// 예시 사진(상세 800px · 목록 200px) — 보일 때만 받는다. 출처는 photos/CREDITS.md
fs.cpSync(path.join(HERE, 'photos'), path.join(DIST, 'files', 'photos'), { recursive: true, filter: (f) => !f.endsWith('.md') });

// 3) 워커 안 가상 파일 — 화면 템플릿·스키마·jsQR
const vfiles = {};
for (const name of fs.readdirSync(path.join(ROOT, 'src/views'), { recursive: true })) {
  const f = path.join(ROOT, 'src/views', name);
  if (f.endsWith('.ejs')) vfiles[`${VROOT}/src/views/${name}`] = fs.readFileSync(f, 'utf8');
}
vfiles[VROOT + '/src/db/schema.sql'] = fs.readFileSync(path.join(ROOT, 'src/db/schema.sql'), 'utf8');
vfiles[VROOT + '/node_modules/jsqr/dist/jsQR.js'] = fs.readFileSync(path.join(ROOT, 'node_modules/jsqr/dist/jsQR.js'), 'utf8');

const env = { APP_MODE: 'demo', AUTH_MODE: 'none', DATA_DIR: VROOT + '/data', BASE_PATH: '' };

const shim = (n) => path.join(HERE, 'shim', n);
const ALIAS = {
  express: shim('express.js'),
  'better-sqlite3': shim('better-sqlite3.js'),
  multer: shim('multer.js'),
  dotenv: shim('dotenv.js'),
  fs: shim('fs.js'),
  crypto: shim('crypto.js'),
  path: path.join(HERE, 'node_modules/path-browserify/index.js'),
  qs: path.join(HERE, 'node_modules/qs/lib/index.js'),
  buffer: path.join(HERE, 'node_modules/buffer/index.js'),
};

const dirnamePlugin = {
  name: 'dirname',
  setup(b) {
    b.onResolve({ filter: /^[a-z@][^:]*$/ }, (args) => (ALIAS[args.path] ? { path: ALIAS[args.path] } : undefined));
    b.onLoad({ filter: /\.js$/ }, async (args) => {
      let src = await fs.promises.readFile(args.path, 'utf8');
      if (/__dirname|__filename/.test(src) && !args.path.startsWith(path.join(HERE, 'shim'))) {
        const v = VROOT + '/' + path.relative(ROOT, args.path);
        src = `var __filename = ${JSON.stringify(v)}, __dirname = ${JSON.stringify(path.posix.dirname(v))};\n` + src;
      }
      return { contents: src, loader: 'js' };
    });
  },
};

const result = await build({
  entryPoints: [path.join(HERE, 'sw-entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  mainFields: ['main', 'module'],
  target: ['chrome100', 'safari15', 'firefox100'],
  inject: [shim('prelude.js')],
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"development"',
    DEMO_ENV: JSON.stringify(JSON.stringify(env)),
    __DEMO_FILES__: JSON.stringify(vfiles),
    BUILD_ID: '"__BUILD_ID__"',
  },
  nodePaths: [path.join(ROOT, 'node_modules'), path.join(HERE, 'node_modules')],
  plugins: [dirnamePlugin],
  write: false,
  minify: !process.env.DEMO_DEBUG,
  legalComments: 'none',
  logLevel: 'warning',
});

let code = result.outputFiles[0].text;
const id = crypto.createHash('sha256').update(seed).update(JSON.stringify(vfiles)).update(code).digest('hex').slice(0, 12);
code = code.replaceAll('__BUILD_ID__', id);
fs.writeFileSync(path.join(DIST, 'sw.js'), code);

for (const f of fs.readdirSync(path.join(HERE, 'shell'))) {
  const src = fs.readFileSync(path.join(HERE, 'shell', f), 'utf8').replaceAll('__BUILD_ID__', id);
  fs.writeFileSync(path.join(DIST, f === 'htaccess' ? '.htaccess' : f), src);
}
const kb = (n) => Math.round(n / 1024) + 'KB';
console.log(`[demo] 완료 — 빌드 ${id}, sw.js ${kb(code.length)}, seed ${kb(seed.length)} → demo/dist/`);
