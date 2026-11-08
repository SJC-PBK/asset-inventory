const path = require('path');
const express = require('express');
const config = require('./config');
const calc = require('./lib/calc');
const { auth, sameOrigin } = require('./middleware/auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 'loopback');
app.set('x-powered-by', false);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.locals.base = config.base;
  res.locals.config = config;
  res.locals.calc = calc;
  res.locals.path = req.path;
  res.locals.msg = typeof req.query.msg === 'string' ? req.query.msg.slice(0, 200) : '';
  res.locals.err = typeof req.query.err === 'string' ? req.query.err.slice(0, 200) : '';
  next();
});

app.use('/static/vendor/jsqr', express.static(path.join(__dirname, '..', 'node_modules', 'jsqr', 'dist'), { maxAge: '7d' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(sameOrigin);
app.use(auth);

app.use(require('./routes/assets'));
app.use(require('./routes/survey'));
app.use(require('./routes/labels'));
app.use(require('./routes/admin'));

app.use((req, res) => res.status(404).render('message', { title: '찾을 수 없음', text: '없는 주소입니다.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).render('message', { title: '오류', text: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.' });
});

if (require.main === module) {
  app.listen(config.port, config.host, () => console.log(`itemmanager http://${config.host}:${config.port}${config.base}/`));
  if (!config.demo) require('./lib/backup').start();
}

module.exports = app;
