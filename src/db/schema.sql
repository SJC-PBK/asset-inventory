-- 재물관리대장. 앱시트 표와의 대응은 docs/appsheet-map.md
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,          -- 관리번호 (S2026-001)
  old_id        TEXT NOT NULL DEFAULT '',  -- 원관리번호
  name          TEXT NOT NULL,             -- 품명
  category      TEXT NOT NULL DEFAULT '',  -- 품목종류
  spec          TEXT NOT NULL DEFAULT '',  -- 규격
  qty           INTEGER,                   -- 수량
  unit_price    INTEGER,                   -- 단가
  amount        INTEGER,                   -- 금액 (단가·수량이 있으면 곱으로 저장)
  purchase_date TEXT NOT NULL DEFAULT '',  -- 구매일자 YYYY-MM-DD
  useful_life   INTEGER,                   -- 내용연수(년)
  location      TEXT NOT NULL DEFAULT '',  -- 현재위치
  holder        TEXT NOT NULL DEFAULT '',  -- 현 사용자
  dept          TEXT NOT NULL DEFAULT '',  -- 담당부서
  approval_doc  TEXT NOT NULL DEFAULT '',  -- 관련기안
  note          TEXT NOT NULL DEFAULT '',  -- 비고
  photo         TEXT NOT NULL DEFAULT '',  -- 사진 파일 이름 (DATA_DIR/photos)
  label_mark    INTEGER NOT NULL DEFAULT 0,-- 라벨(유지보수 라벨 대상)
  disused       INTEGER NOT NULL DEFAULT 0,-- 불용처리
  discard_date  TEXT NOT NULL DEFAULT '',  -- 폐기일자 (있으면 폐기완료)
  discard_reason TEXT NOT NULL DEFAULT '', -- 폐기사유
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by    TEXT NOT NULL DEFAULT ''
);

-- 자산변동사항: 바뀌기 직전 모습을 남긴다
CREATE TABLE IF NOT EXISTS asset_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  changed_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reason        TEXT NOT NULL DEFAULT '',  -- 수정 / 재물조사 / 불용 / 복구 / 폐기 / 이전 기록
  changes       TEXT NOT NULL DEFAULT '',  -- "현재위치: 3층 → 4층" 줄바꿈 목록
  name          TEXT NOT NULL DEFAULT '',
  spec          TEXT NOT NULL DEFAULT '',
  qty           INTEGER,
  unit_price    INTEGER,
  amount        INTEGER,
  purchase_date TEXT NOT NULL DEFAULT '',
  prev_location TEXT NOT NULL DEFAULT '',
  prev_holder   TEXT NOT NULL DEFAULT '',
  dept          TEXT NOT NULL DEFAULT '',
  approval_doc  TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  changed_by    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS asset_history_asset ON asset_history(asset_id, changed_at);

-- 불용물품: 자산 하나에 한 줄. 불용 복구하면 지운다(앱시트와 같음)
CREATE TABLE IF NOT EXISTS disposals (
  asset_id      TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  moved_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')), -- 불용이감일시
  grade         TEXT NOT NULL DEFAULT '',  -- 상태 A~D
  decided_on    TEXT NOT NULL DEFAULT '',  -- 불용결정일자
  reason        TEXT NOT NULL DEFAULT '',  -- 불용결정사유
  place         TEXT NOT NULL DEFAULT '',  -- 물품소재지
  opinion       TEXT NOT NULL DEFAULT '',  -- 처분의견
  processed_on  TEXT NOT NULL DEFAULT '',  -- 처리일자
  result        TEXT NOT NULL DEFAULT '',  -- 처리결과
  note          TEXT NOT NULL DEFAULT ''
);

-- 재물조사 회차. 앱시트의 '조사목록 초기화' 대신 회차를 새로 연다(지난 조사 기록이 남는다)
CREATE TABLE IF NOT EXISTS surveys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at   TEXT NOT NULL DEFAULT '',
  started_by  TEXT NOT NULL DEFAULT ''
);

-- 조사목록: 회차마다 자산 한 줄(다시 스캔하면 덮어쓴다)
CREATE TABLE IF NOT EXISTS survey_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id   INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  checked_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  remark      TEXT NOT NULL DEFAULT '',    -- 조사특이사항
  changed     INTEGER NOT NULL DEFAULT 0,  -- 변동여부
  location    TEXT NOT NULL DEFAULT '',
  holder      TEXT NOT NULL DEFAULT '',
  dept        TEXT NOT NULL DEFAULT '',
  checked_by  TEXT NOT NULL DEFAULT '',
  UNIQUE (survey_id, asset_id)
);

-- 선택 목록(앱시트 DB 표): location 현재위치 / holder 현 사용자 / dept 담당부서 / category 품목종류
CREATE TABLE IF NOT EXISTS options (
  kind   TEXT NOT NULL,
  value  TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, value)
);

-- 직원 명부 사본(scripts/sync-staff.js 가 매일 맞춘다). status: active 재직 / leave 휴직 / retired 퇴사
CREATE TABLE IF NOT EXISTS staff (
  email     TEXT PRIMARY KEY,
  name      TEXT NOT NULL DEFAULT '',
  dept      TEXT NOT NULL DEFAULT '',
  position  TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 관리 권한(자산 삭제·목록 관리·권한 관리). 직원 명부에서 골라 준다
CREATE TABLE IF NOT EXISTS roles (
  email      TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL DEFAULT '',
  granted_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
