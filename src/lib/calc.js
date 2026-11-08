// 앱시트·시트 수식으로 계산하던 값들

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

// 시트 DATEDIF(구매일자, 오늘, "M") 와 같은 '꽉 찬 개월 수'
function monthsBetween(from, to) {
  const a = parseDate(from), b = parseDate(to);
  if (!a || !b) return null;
  let n = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) n -= 1;
  return Math.max(0, n);
}

// 사용기간 "3년 2개월"
function usePeriod(purchaseDate, now = today()) {
  const n = monthsBetween(purchaseDate, now);
  if (n === null) return '';
  return `${Math.floor(n / 12)}년 ${n % 12}개월`;
}

// 내용연수 경과여부: 도래 / 미도래 / ''
function lifeState(purchaseDate, usefulLife, now = today()) {
  const n = monthsBetween(purchaseDate, now);
  if (n === null || !usefulLife) return '';
  return n >= usefulLife * 12 ? '도래' : '미도래';
}

// 처리상태
function status(a) {
  if (a.discard_date) return '폐기완료';
  if (a.disused) return '불용';
  return '사용중';
}

function amountOf(qty, price, fallback) {
  if (qty != null && price != null) return qty * price;
  return fallback ?? null;
}

function won(n) {
  return n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR');
}

module.exports = { today, monthsBetween, usePeriod, lifeState, status, amountOf, won };
