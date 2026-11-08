// 확인 창
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset && e.target.dataset.confirm;
  if (msg && !confirm(msg)) e.preventDefault();
});

// 구매일자를 바꾸면 새 관리번호도 그 연도로 (직접 고친 뒤에는 그대로 둔다)
const idInput = document.getElementById('f-id');
const dateInput = document.getElementById('f-date');
if (idInput && dateInput && idInput.dataset.auto) {
  idInput.addEventListener('input', () => { delete idInput.dataset.auto; });
  dateInput.addEventListener('change', async () => {
    if (!idInput.dataset.auto) return;
    const base = location.pathname.replace(/\/new$/, '');
    const r = await fetch(`${base}/next-id?date=${encodeURIComponent(dateInput.value)}`);
    if (r.ok && idInput.dataset.auto) idInput.value = await r.text();
  });
}

// 조사: '바뀌었음'을 고르면 위치·사용자·부서 칸을 보인다
const changed = document.getElementById('changed');
if (changed) changed.addEventListener('change', () => { document.getElementById('change-fields').hidden = !changed.checked; });

// 사진: 고르면 1600px JPEG 로 줄여서 바로 올린다(휴대폰 사진이 커서)
for (const input of document.querySelectorAll('input[data-autosubmit]')) {
  input.addEventListener('change', async () => {
    const form = input.form, file = input.files[0];
    if (!file) return;
    try {
      const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
      const fd = new FormData();
      fd.append('photo', blob, 'photo.jpg');
      const r = await fetch(form.action, { method: 'POST', body: fd });
      location.href = r.url;
    } catch {
      form.submit();
    }
  });
}
