// QR SVG. qrcode 의 핵심·SVG 부품만 써서(PNG 부품 없이) 시연판 브라우저에서도 같이 돈다.
const QRCode = require('qrcode/lib/core/qrcode');
const SvgTag = require('qrcode/lib/renderer/svg-tag');

module.exports = function qrSvg(text) {
  return SvgTag.render(QRCode.create(String(text), { errorCorrectionLevel: 'M' }), { margin: 0 });
};
