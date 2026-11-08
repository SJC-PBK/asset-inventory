// 브라우저 시연판용 대체 부품.
// multer 흉내 — sw-entry.js 가 FormData 의 파일을 req.__files 에 넣어 둔다.
const fs = require('fs');
const path = require('path');

function multer(opts = {}) {
  const storage = opts.storage || { __memory: true };
  const limits = opts.limits || {};
  function single(field) {
    return function multerSingle(req, res, cb) {
      const f = req.__files && req.__files[field];
      if (!f || !f.size) return cb();
      const file = { fieldname: field, originalname: f.name, mimetype: f.type, size: f.size, encoding: '7bit' };
      if (limits.fileSize && f.size > limits.fileSize) {
        const e = new Error('File too large');
        e.code = 'LIMIT_FILE_SIZE';
        return cb(e);
      }
      const go = () => {
        if (storage.__memory) {
          file.buffer = Buffer.from(f.bytes);
          req.file = file;
          return cb();
        }
        storage.destination(req, file, (e1, dest) => {
          if (e1) return cb(e1);
          storage.filename(req, file, (e2, name) => {
            if (e2) return cb(e2);
            file.destination = dest;
            file.filename = name;
            file.path = path.join(dest, name);
            fs.writeFileSync(file.path, f.bytes);
            req.file = file;
            cb();
          });
        });
      };
      if (opts.fileFilter) {
        return opts.fileFilter(req, file, (err, ok) => {
          if (err) return cb(err);
          if (!ok) return cb();
          go();
        });
      }
      go();
    };
  }
  return { single, none: () => (req, res, cb) => cb() };
}
multer.diskStorage = (o) => ({ destination: o.destination, filename: o.filename });
multer.memoryStorage = () => ({ __memory: true });
module.exports = multer;
