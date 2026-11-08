// 브라우저 시연판용 대체 부품.
// better-sqlite3 흉내 — 브라우저(sql.js) 위에서 앱 모델 코드가 그대로 돌게 한다.
// 앱이 쓰는 것만: new Database() · prepare().run/get/all · exec · pragma · transaction · close.
// sql.js 의 export() 는 연결을 닫았다 다시 열어 준비된 문장이 모두 풀린다.
// 그래서 문장은 SQL 글자만 들고 있다가 '세대(gen)'가 바뀌면 새로 준비한다.

const state = {
  sql: null,      // sql.js 의 Database (sw-entry.js 가 넣는다)
  gen: 0,         // export·교체 때마다 올린다
  dirty: false,   // 쓰기가 있었는가 — 저장할지 정한다
};

function setDatabase(sqlDb) {
  state.sql = sqlDb;
  state.gen += 1;
  applyPragmas();
}

function applyPragmas() {
  state.sql.run('PRAGMA foreign_keys = ON');
}

// sql.js 바이트로 꺼내기. 연결이 다시 열리므로 pragma 를 다시 건다.
function exportBytes() {
  const bytes = state.sql.export();
  state.gen += 1;
  applyPragmas();
  state.dirty = false;
  return bytes;
}

const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM)/i;

// better-sqlite3 는 객체 인자의 키에 접두사(@ : $)를 붙이지 않는다. sql.js 는 붙여야 한다.
function bindParams(sql, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
      && !(args[0] instanceof Uint8Array)) {
    const o = args[0];
    const out = {};
    const names = sql.match(/[@:$][A-Za-z_][A-Za-z0-9_]*/g) || [];
    names.forEach((n) => {
      const k = n.slice(1);
      if (Object.prototype.hasOwnProperty.call(o, k)) out[n] = norm(o[k]);
      else throw new RangeError('Missing named parameter "' + k + '"');
    });
    return out;
  }
  const flat = [];
  args.forEach((a) => (Array.isArray(a) ? a.forEach((x) => flat.push(norm(x))) : flat.push(norm(a))));
  return flat;
}

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
  if (typeof v === 'bigint') return Number(v);
  return v;
}

class Statement {
  constructor(sql) {
    this.source = sql;
    this.reader = /^\s*(SELECT|PRAGMA|WITH)/i.test(sql) && !/\bRETURNING\b/i.test(sql);
    this._stmt = null;
    this._gen = -1;
    this._pluck = false;
  }

  _get() {
    if (!this._stmt || this._gen !== state.gen) {
      this._stmt = state.sql.prepare(this.source);
      this._gen = state.gen;
    }
    return this._stmt;
  }

  pluck(on = true) {
    this._pluck = on;
    return this;
  }

  _rows(args, limit) {
    const st = this._get();
    try {
      const p = bindParams(this.source, args);
      st.bind(p);
      const out = [];
      while (st.step()) {
        const row = st.getAsObject();
        out.push(this._pluck ? row[Object.keys(row)[0]] : row);
        if (limit && out.length >= limit) break;
      }
      return out;
    } catch (e) {
      throw wrapErr(e);
    } finally {
      st.reset();
    }
  }

  get(...args) {
    return this._rows(args, 1)[0];
  }

  all(...args) {
    return this._rows(args, 0);
  }

  iterate(...args) {
    return this._rows(args, 0)[Symbol.iterator]();
  }

  run(...args) {
    const st = this._get();
    try {
      st.bind(bindParams(this.source, args));
      while (st.step()) { /* RETURNING 등 */ }
    } catch (e) {
      throw wrapErr(e);
    } finally {
      st.reset();
    }
    state.dirty = true;
    const changes = state.sql.getRowsModified();
    const r = state.sql.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = r.length ? r[0].values[0][0] : 0;
    return { changes, lastInsertRowid };
  }
}

// 앱은 e.code 로 제약 위반을 가른다(SQLITE_CONSTRAINT_UNIQUE 등).
function wrapErr(e) {
  if (e && e.code) return e;
  const msg = String((e && e.message) || e);
  const err = new Error(msg);
  if (/UNIQUE constraint/i.test(msg)) err.code = 'SQLITE_CONSTRAINT_UNIQUE';
  else if (/FOREIGN KEY constraint/i.test(msg)) err.code = 'SQLITE_CONSTRAINT_FOREIGNKEY';
  else if (/NOT NULL constraint/i.test(msg)) err.code = 'SQLITE_CONSTRAINT_NOTNULL';
  else if (/CHECK constraint/i.test(msg)) err.code = 'SQLITE_CONSTRAINT_CHECK';
  else if (/constraint/i.test(msg)) err.code = 'SQLITE_CONSTRAINT';
  else err.code = 'SQLITE_ERROR';
  return err;
}

let txDepth = 0;

class Database {
  constructor() {
    if (!state.sql) throw new Error('시연판: DB 가 아직 준비되지 않았습니다');
    this.open = true;
    this.memory = false;
  }

  prepare(sql) {
    return new Statement(sql);
  }

  exec(sql) {
    try {
      state.sql.exec(sql);
    } catch (e) {
      throw wrapErr(e);
    }
    if (WRITE_RE.test(sql) || /;\s*(INSERT|UPDATE|DELETE)/i.test(sql)) state.dirty = true;
    return this;
  }

  pragma(src, opts = {}) {
    // WAL 은 sql.js 메모리 DB 에 뜻이 없다 — 조용히 넘긴다
    if (/journal_mode|wal_checkpoint/i.test(src)) return opts.simple ? 'memory' : [];
    const rows = this.prepare('PRAGMA ' + src).all();
    if (opts.simple) return rows.length ? rows[0][Object.keys(rows[0])[0]] : undefined;
    return rows;
  }

  transaction(fn) {
    const self = this;
    return function wrapped(...args) {
      const sp = 'demo_sp_' + txDepth;
      const outer = txDepth === 0;
      self.exec(outer ? 'BEGIN' : 'SAVEPOINT ' + sp);
      txDepth += 1;
      try {
        const out = fn.apply(this, args);
        txDepth -= 1;
        self.exec(outer ? 'COMMIT' : 'RELEASE ' + sp);
        return out;
      } catch (e) {
        txDepth -= 1;
        try {
          self.exec(outer ? 'ROLLBACK' : 'ROLLBACK TO ' + sp + '; RELEASE ' + sp);
        } catch (_) { /* 이미 풀림 */ }
        throw e;
      }
    };
  }

  close() {
    return this;
  }
}

Database.__demo = { state, setDatabase, exportBytes };
module.exports = Database;
