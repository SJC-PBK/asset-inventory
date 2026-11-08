// 휴대폰 카메라로 라벨 QR 읽기 → 조사 기록 화면으로. jsQR(Apache-2.0) 사용, 외부 서버 없음.
(() => {
  const checkUrl = document.currentScript.dataset.check;
  const video = document.getElementById('cam');
  const canvas = document.getElementById('frame');
  const state = document.getElementById('scan-state');
  const startBtn = document.getElementById('cam-start');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let done = false;

  function found(text) {
    if (done) return;
    done = true;
    if (navigator.vibrate) navigator.vibrate(80);
    state.textContent = `읽음: ${text}`;
    location.href = checkUrl + encodeURIComponent(text);
  }

  function tick() {
    if (done) return;
    if (video.readyState >= 2) {
      const s = Math.min(video.videoWidth, video.videoHeight, 720);
      const sx = (video.videoWidth - s) / 2, sy = (video.videoHeight - s) / 2;
      canvas.width = s; canvas.height = s;
      ctx.drawImage(video, sx, sy, s, s, 0, 0, s, s);
      const code = window.jsQR(ctx.getImageData(0, 0, s, s).data, s, s, { inversionAttempts: 'dontInvert' });
      if (code && code.data) return found(code.data.trim());
    }
    requestAnimationFrame(tick);
  }

  async function start() {
    startBtn.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state.textContent = '이 브라우저에서는 카메라를 쓸 수 없습니다. 아래 칸에 관리번호를 적어 주세요.';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      state.textContent = '라벨의 QR 코드를 화면 가운데에 맞춰 주세요.';
      requestAnimationFrame(tick);
    } catch {
      state.textContent = '카메라를 켜지 못했습니다. 브라우저에서 카메라 권한을 허용하거나 아래 칸에 관리번호를 적어 주세요.';
      startBtn.hidden = false;
    }
  }

  startBtn.addEventListener('click', start);
  start();
})();
