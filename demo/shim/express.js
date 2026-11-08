// 브라우저 시연판용 대체 부품.
// express 흉내 — 서비스 워커 안에서 앱의 라우터·미들웨어를 그대로 돌린다.
// 앱이 실제로 쓰는 범위만 만든다(app/Router 의 use·get·post, req·res 의 일부).
const ejs = require('ejs');
const path = require('path');
const qs = require('qs');
const vfs = require('fs');

function compile(p) {
  // '/:id/edit' → 정규식 + 이름 목록
  const keys = [];
  const src = p
    .replace(/\/+$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : '\\' + c))
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    });
  return { re: new RegExp('^' + src + '/?$'), keys };
}

function createRouter() {
  const stack = [];

  function router(req, res, out) {
    let i = 0;
    const savedUrl = req.url;
    const savedBase = req.baseUrl;
    let current = null;

    function restore() {
      req.url = savedUrl;
      req.baseUrl = savedBase;
    }

    function next(err) {
      if (current) {
        req.url = current.url;
        req.baseUrl = current.base;
        current = null;
      }
      if (err === 'router') {
        restore();
        return out();
      }
      while (i < stack.length) {
        const layer = stack[i++];
        const p = req.path;
        if (layer.route) {
          if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) continue;
          const m = layer.match.re.exec(p);
          if (!m) continue;
          req.params = {};
          layer.match.keys.forEach((k, j) => {
            req.params[k] = decodeURIComponent(m[j + 1]);
          });
          return runChain(layer.fns, err, req, res, next);
        }
        // use(): 앞부분이 맞으면 그 아래를 넘긴다
        const mount = layer.path;
        if (mount !== '/' && p !== mount && !p.startsWith(mount + '/')) continue;
        current = { url: req.url, base: req.baseUrl };
        if (mount !== '/') {
          const rest = req.url.slice(mount.length);
          req.baseUrl = (req.baseUrl || '') + mount;
          req.url = rest.startsWith('/') ? rest : '/' + rest;
        }
        return runChain(layer.fns, err, req, res, next);
      }
      restore();
      return out(err);
    }

    next();
  }

  // 한 layer 안의 함수들을 차례로. 오류가 있으면 4인자 함수만, 없으면 그 밖만.
  function runChain(fns, err, req, res, done) {
    let k = 0;
    function step(e) {
      if (e && e !== 'route' && e !== 'router') err = e;
      if (e === 'route') return done();
      if (e === 'router') return done('router');
      while (k < fns.length) {
        const fn = fns[k++];
        const isErr = fn.length === 4;
        if (err ? !isErr : isErr) continue;
        try {
          const r = err ? fn(err, req, res, step) : fn(req, res, step);
          if (r && typeof r.then === 'function') r.then(null, step);
        } catch (ex) {
          step(ex);
        }
        return;
      }
      done(err);
    }
    step();
  }

  router.stack = stack;
  router.use = function use(...args) {
    let p = '/';
    if (typeof args[0] === 'string') p = args.shift();
    stack.push({ route: false, path: p.replace(/\/+$/, '') || '/', fns: args.flat() });
    return router;
  };
  ['get', 'post', 'put', 'delete', 'patch', 'all'].forEach((m) => {
    router[m] = function route(p, ...fns) {
      stack.push({ route: true, method: m === 'all' ? null : m.toUpperCase(), match: compile(p), fns: fns.flat() });
      return router;
    };
  });
  return router;
}

function Router() {
  return createRouter();
}

function createApplication() {
  const router = createRouter();
  const settings = {};

  function app(req, res, done) {
    req.app = app;
    res.app = app;
    router(req, res, done || finalHandler(req, res));
  }

  app.locals = {};
  app.set = (k, v) => {
    settings[k] = v;
    return app;
  };
  app.enable = (k) => app.set(k, true);
  app.use = (...a) => {
    router.use(...a);
    return app;
  };
  ['post', 'put', 'delete', 'patch', 'all'].forEach((m) => {
    app[m] = (...a) => {
      router[m](...a);
      return app;
    };
  });
  app.get = (...a) => {
    if (a.length === 1) return settings[a[0]];
    router.get(...a);
    return app;
  };
  app.listen = () => ({ close() {} });

  app.render = function render(name, data, cb) {
    const views = settings.views || '/app/src/views';
    const file = path.join(views, name.endsWith('.ejs') ? name : name + '.ejs');
    ejs.renderFile(file, data, { cache: true }, cb);
  };
  return app;
}

function finalHandler(req, res) {
  return function done(err) {
    if (res.headersSent) return;
    if (!err) {
      res.status(404).type('text/plain').send('Cannot ' + req.method + ' ' + req.originalUrl);
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[시연판]', err);
    const message = err.demoNotice ? err.message : '처리 중 오류가 났습니다: ' + (err.message || err);
    try {
      res.status(err.demoNotice ? 200 : 500).render('error', {
        user: req.session && req.session.user,
        title: err.demoNotice ? '시연판 안내' : '오류',
        message,
      });
    } catch (e) {
      res.status(500).type('text/plain').send(message);
    }
  };
}

// ---- 정적 파일 ----
// public/ 아래는 홈페이지에 그대로 올린 파일을 네트워크에서 가져온다(sw-entry.js 가 처리).
// 그 밖(업로드한 메뉴 사진)은 브라우저 안 가상 파일에서 읽는다.
const MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

function serveStatic(root, opts = {}) {
  return function staticMw(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rel = decodeURIComponent(req.path);
    if (rel.includes('..')) return next();
    const file = path.join(root, rel);
    if (root.startsWith('/app/public')) {
      res.__network = file.replace('/app/public', '');
      return res.end();
    }
    if (!vfs.existsSync(file) || vfs.statSync(file).isDirectory()) {
      if (opts.fallthrough === false) return res.status(404).type('text/plain').send('Not Found');
      return next();
    }
    res.type(path.extname(file)).send(vfs.readFileSync(file));
  };
}

function noopParser() {
  return (req, res, next) => next();
}

const express = createApplication;
express.Router = Router;
express.static = serveStatic;
express.urlencoded = noopParser;
express.json = noopParser;
express.__MIME = MIME;

// ---- 요청·응답 ----
// sw-entry.js 가 Request 를 이것들로 바꿔 app 에 넘기고, 끝나면 Response 로 되돌린다.
function makeReq({ method, url, headers, body, files, isKiosk, session }) {
  const req = {
    method,
    url,
    originalUrl: url,
    baseUrl: '',
    headers,
    body: body || {},
    params: {},
    session,
    ip: '127.0.0.1',
    ips: [],
    protocol: 'https',
    secure: true,
    hostname: 'localhost',
    socket: { localPort: isKiosk ? 4001 : 4000, remoteAddress: '127.0.0.1' },
    __files: files || {},
    get(name) {
      return headers[String(name).toLowerCase()];
    },
    accepts(types) {
      const list = Array.isArray(types) ? types : [types];
      const acc = headers.accept || '*/*';
      for (const t of list) {
        const full = t.includes('/') ? t : t === 'json' ? 'application/json' : t === 'html' ? 'text/html' : t;
        if (acc.includes(full)) return t;
      }
      return acc.includes('*/*') ? list[0] : false;
    },
  };
  req.header = req.get;
  Object.defineProperty(req, 'path', {
    get() {
      return this.url.split('?')[0] || '/';
    },
  });
  Object.defineProperty(req, 'query', {
    get() {
      const q = this.url.split('?')[1] || '';
      return qs.parse(q);
    },
  });
  return req;
}

function makeRes(req, onFinish) {
  const listeners = { finish: [] };
  const res = {
    statusCode: 200,
    headers: {},
    locals: {},
    headersSent: false,
    body: null,
    status(n) {
      this.statusCode = n;
      return this;
    },
    sendStatus(n) {
      return this.status(n).type('text/plain').send(String(n));
    },
    setHeader(k, v) {
      this.headers[String(k).toLowerCase()] = String(v);
      return this;
    },
    set(k, v) {
      if (typeof k === 'object') Object.keys(k).forEach((x) => this.setHeader(x, k[x]));
      else this.setHeader(k, v);
      return this;
    },
    header(k, v) {
      return this.set(k, v);
    },
    getHeader(k) {
      return this.headers[String(k).toLowerCase()];
    },
    get(k) {
      return this.getHeader(k);
    },
    type(t) {
      const v = t.startsWith('.') ? MIME[t] || 'application/octet-stream' : t.includes('/') ? t : MIME['.' + t] || t;
      return this.setHeader('content-type', v);
    },
    append(k, v) {
      return this.setHeader(k, v);
    },
    cookie() {
      return this;
    },
    clearCookie() {
      return this;
    },
    attachment(name) {
      if (name) this.setHeader('content-disposition', 'attachment; filename="' + encodeURIComponent(name) + '"');
      return this;
    },
    redirect(a, b) {
      let status = 302;
      let loc = a;
      if (typeof a === 'number') {
        status = a;
        loc = b;
      }
      if (loc === 'back') loc = req.get('referer') || '/';
      this.statusCode = status;
      this.setHeader('location', loc);
      return this.end();
    },
    json(obj) {
      if (!this.headers['content-type']) this.type('application/json; charset=utf-8');
      return this.send(JSON.stringify(obj));
    },
    send(body) {
      if (body === undefined || body === null) body = '';
      if (typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
        return this.json(body);
      }
      if (typeof body === 'string' && !this.headers['content-type']) this.type('text/html; charset=utf-8');
      if (body instanceof Uint8Array && !this.headers['content-type']) this.type('application/octet-stream');
      this.body = body;
      return this.end();
    },
    write(chunk) {
      this.__chunks = this.__chunks || [];
      this.__chunks.push(chunk);
      return true;
    },
    end(chunk) {
      if (this.headersSent) return this;
      if (chunk !== undefined) this.write(chunk);
      if (this.__chunks && this.body === null) this.body = this.__chunks.join('');
      this.headersSent = true;
      this.finished = true;
      listeners.finish.forEach((f) => {
        try {
          f();
        } catch (e) { /* 무시 */ }
      });
      onFinish(this);
      return this;
    },
    on(ev, fn) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return this;
    },
    once(ev, fn) {
      return this.on(ev, fn);
    },
    sendFile(file, opts, cb) {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      try {
        const data = vfs.readFileSync(file);
        if (opts && opts.headers) this.set(opts.headers);
        if (!this.headers['content-type']) this.type(path.extname(file));
        this.send(data);
        if (cb) cb();
      } catch (e) {
        if (cb) cb(e);
        else this.status(404).send('Not Found');
      }
    },
    download(file, name) {
      this.attachment(name || path.basename(file));
      return this.sendFile(file);
    },
    render(view, data, cb) {
      if (typeof data === 'function') {
        cb = data;
        data = {};
      }
      const app = this.app;
      const locals = Object.assign({}, app.locals, this.locals, data || {});
      app.render(view, locals, (err, html) => {
        if (cb) return cb(err, html);
        if (err) {
          // eslint-disable-next-line no-console
          console.error('[시연판] 화면 오류', view, err);
          this.status(500).type('text/plain').send('화면 오류: ' + err.message);
          return;
        }
        this.send(html);
      });
    },
  };
  return res;
}

express.__makeReq = makeReq;
express.__makeRes = makeRes;
module.exports = express;
