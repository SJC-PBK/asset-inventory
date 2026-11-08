# 재물관리대장 (Asset Inventory)

기관의 물품(자산)을 관리하는 웹앱입니다. 자산 대장, 휴대폰 QR 재물조사, 불용·폐기 처리, 라벨 인쇄를 한 화면에서 합니다.
앱시트(AppSheet)와 구글 시트로 재물관리를 하던 것을 옮기려고 만들었고, 앱시트 자료를 그대로 가져오는 스크립트가 들어 있습니다.

*A small web app for tracking an organization's physical assets: asset register, QR-code stocktaking from a phone, disposal workflow and label printing. Node.js + SQLite, no external services. UI is in Korean.*

## 할 수 있는 것

- **자산 대장**: 관리번호(`S연도-번호`, 자동)·품명·규격·금액·구매일자·위치·사용자·부서·사진·관련 문서. 사용 기간·내용연수 도래 여부는 자동 계산.
- **변동 이력**: 위치·사용자 등을 고치면 바뀌기 전 모습이 자동으로 남습니다.
- **재물조사**: 조사 회차를 열고 휴대폰으로 라벨 QR 을 찍으면 그 자산 확인 화면이 뜹니다. 바뀐 위치·사용자는 그 자리에서 고치고, 완료·미조사 현황을 한눈에 봅니다. 바코드 스캐너나 직접 입력도 됩니다.
- **불용·폐기**: 불용 처리(상태 A~D·사유·처분 의견) → 폐기 완료, 잘못했으면 불용 복구.
- **라벨 인쇄**: 폼텍 3218(A4 18칸) 라벨. 전체 / 표시한 것만 / 번호 지정, 쓰다 남은 라벨지는 건너뛸 칸 수 지정.
- **선택 목록·권한**: 위치·사용자·부서·품목 종류 목록 관리, 직원 명부에서 관리 권한 부여.

외부 CDN·외부 API 를 쓰지 않습니다(QR 은 서버에서 `qrcode` 로 만들고, 스캔은 브라우저에서 `jsqr` 로 읽습니다). 인터넷이 막힌 내부망에서도 동작합니다.

## 켜기

필요한 것: **Node.js 20 이상**.

```bash
git clone https://github.com/SJC-PBK/asset-inventory.git
cd asset-inventory
npm install
npm test                                   # 시험

# 지어낸 시연 자료로 바로 켜 보기 (로그인 없음)
DATA_DIR=./data AUTH_MODE=none node scripts/seed-demo.js
DATA_DIR=./data AUTH_MODE=none npm start   # http://127.0.0.1:5214/
```

휴대폰 카메라로 QR 을 찍으려면 HTTPS 가 필요합니다. 운영할 때는 nginx 같은 웹 서버 뒤에 두고 HTTPS 로 여세요.

## 설정 (환경 변수 또는 `.env`)

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `PORT` · `HOST` | `5214` · `127.0.0.1` | 듣는 주소 |
| `BASE_PATH` | (없음) | 하위 경로에 붙일 때. 예: `https://example.org/items/` → `/items` |
| `DATA_DIR` | `./data` | DB·사진·하루 사본(`backups/`) 폴더 |
| `AUTH_MODE` | `sso` | `sso` = 로그인 쿠키 필수, `none` = 로그인 없음(개발·시연용 — 운영에 쓰지 마세요) |
| `SCV_SSO_SECRET` | (없음) | 로그인 쿠키 서명 비밀값 |
| `SSO_LOGIN_URL` | `/settings/login` | 로그인 안 된 사람을 보낼 주소(`?next=` 붙음) |
| `STAFF_EMAIL_DOMAIN` | `example.org` | 이 도메인 메일만 들어옴 |
| `ADMINS` | (없음) | 언제나 관리 권한을 갖는 메일(쉼표) |
| `ORG_NAME` | `우리 기관` | 라벨에 찍히는 기관 이름 |

### 로그인

이 앱은 로그인 화면을 따로 갖지 않고, 같은 도메인의 로그인 창구(구글 로그인 등 직접 만든 프로그램)가 둔 쿠키 `scv_sso` 를 확인합니다.

```
scv_sso = base64url(JSON {email, name, exp(밀리초)}) + "." + base64url(HMAC-SHA256(비밀값, "scv_sso" + 앞부분))
```

만드는 쪽 예시는 `src/lib/sso.js` 의 `sign()` 과 `test/app.test.js` 를 보세요. 로그인 창구가 없으면 nginx 기본 인증 등으로 막고 `AUTH_MODE=none` 으로 쓸 수도 있습니다(이때는 모두 관리자).

### 직원 명부 (선택)

명부를 넣으면 재직·휴직 직원만 들어오고, 퇴사자는 관리 권한이 있어도 막힙니다. 명부가 비어 있으면 `STAFF_EMAIL_DOMAIN` 메일이면 누구나 들어옵니다.

```bash
# 탭으로 나눈 글, 첫 줄은 머리글. status = active(재직) / leave(휴직) / retired(퇴사)
printf 'email\tname\tdept\tposition\tstatus\nhong@example.org\t홍길동\t운영지원팀\t팀장\tactive\n' | DATA_DIR=./data node scripts/sync-staff.js
```

인사·그룹웨어 DB 에서 매일 뽑아 넘기도록 cron·systemd 타이머에 걸어 두면 됩니다.

## 앱시트 자료 가져오기

앱시트 앱의 구글 시트를 **.xlsx 로 내려받아** 넣습니다. 시트 이름: `자산목록` · `불용물품` · `자산변동사항` · `조사목록`(진행 중 회차) · `조사목록25`(마감된 회차) · `DB`(선택 목록). 열은 이름으로 찾습니다.

```bash
node scripts/import-xlsx.js 자산목록.xlsx                       # 읽기만 — 건수와 문제만 보여 줌
DATA_DIR=./data node scripts/import-xlsx.js 자산목록.xlsx --apply --photos <사진 폴더들이 든 폴더>
```

- `--apply`: 빈 DB 에만 넣습니다.
- `--replace`: 지금 DB 를 `backups/` 에 사본으로 남기고 다시 넣습니다(전환하는 날 최종본 반영). 이 앱에서 직원이 고친 기록이 있으면 멈추고, 그래도 지우려면 `--discard-app-edits` 를 함께 줍니다.
- `--photos-only`: 사진이 없는 자산에 앱시트 사진만 붙입니다. 사진 칸의 `자산목록_Images/파일.jpg` 같은 값을 그대로 찾습니다.

열 이름이 다른 앱시트 앱이라면 `scripts/import-xlsx.js` 의 열 이름만 맞추면 됩니다.

## 브라우저 시연판

서버 없이 브라우저 안에서 같은 앱을 돌리는 정적 파일을 만듭니다(서비스 워커 + sql.js). 지어낸 자료가 들어 있고, 방문자가 입력한 것은 그 브라우저에만 저장됩니다.

```bash
npm install && (cd demo && npm ci && npm run build)   # → demo/dist/ 를 아무 정적 호스팅에 올림
```

Apache 라면 `demo/shell/htaccess` 가 `.htaccess` 로 함께 들어갑니다. 시연 사진(`demo/photos/`)은 AI 로 만든 그림입니다(`demo/photos/CREDITS.md`).

## 구조

- Node.js + Express 4 + better-sqlite3 + EJS
- `src/server.js` 앱 · `src/config.js` 설정 · `src/db/schema.sql` 표
- `src/models/` 자산(대장·이력·불용)·재물조사 회차·선택 목록·직원 명부
- `src/routes/` 자산·재물조사·라벨·관리
- `scripts/` 앱시트 가져오기·직원 명부·시연 자료 · `demo/` 브라우저 시연판 빌드 · `test/` 시험

## 라이선스

MIT — `LICENSE`. 서울특별시장애인일자리센터가 내부용으로 만든 것을 공개합니다. 이슈·PR 은 반영이 늦을 수 있습니다.
