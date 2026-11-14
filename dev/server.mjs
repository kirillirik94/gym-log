// Dev-сервер для проверки без настоящего Google.
//   :8765 — статика приложения (как GitHub Pages)
//   :8766 — эмулятор Apps Script web app: исполняет настоящий apps-script/Code.gs
//           поверх таблицы в памяти (другой origin, как script.google.com).
// Админ-ручки эмулятора: GET /admin/state, POST /admin/reset, POST /admin/drop-next, POST /admin/fail-next
// Запуск: node dev/server.mjs   (секрет эмулятора: env GYM_SECRET, по умолчанию dev-secret)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = Number(process.env.APP_PORT || 8765);
const GAS_PORT = Number(process.env.GAS_PORT || 8766);
const SECRET = process.env.GYM_SECRET || 'dev-secret';

/* ---------- Фейковая таблица ---------- */

function typed(v) {
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  if (typeof v === 'string' && /^-?\d+(,\d+)?$/.test(v)) return Number(v.replace(',', '.'));
  return v;
}

const HEADERS = {
  Log: ['workout_id', 'date', 'day_type', 'exercise_id', 'exercise_name', 'order', 'set_no', 'is_warmup', 'weight_kg', 'is_bodyweight', 'added_kg', 'reps', 'done', 'rir', 'created_at'],
  Sessions: ['workout_id', 'date', 'start', 'end', 'duration_min', 'day_type', 'title', 'feel_1_5', 'sleep_1_5', 'food_1_3', 'mood_1_5', 'back_ok', 'comment', 'bodyweight_kg', 'volume_kg', 'volume_work_kg', 'sets', 'reps', 'prs_json', 'app_version'],
  Bodyweight: ['date', 'weight_kg', 'workout_id'],
};

let sheets;
function reset() {
  const fixturePath = path.join(ROOT, 'dev/fixtures/sheet.local.json');
  const fx = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : { Program: [[]], Exercises: [[]] };
  sheets = {
    Log: [HEADERS.Log.slice()],
    Sessions: [HEADERS.Sessions.slice()],
    Bodyweight: [HEADERS.Bodyweight.slice()],
    Program: fx.Program.map((r) => r.map(typed)),
    Exercises: fx.Exercises.map((r) => r.map(typed)),
  };
}
reset();

function makeSheet(name) {
  const data = () => sheets[name];
  const lastCol = () => Math.max(0, ...data().map((r) => {
    let n = r.length;
    while (n && (r[n - 1] === '' || r[n - 1] === undefined)) n--;
    return n;
  }));
  return {
    getName: () => name,
    getLastRow: () => data().length,
    getLastColumn: lastCol,
    getRange(row, col, nr = 1, nc = 1) {
      return {
        getValues() {
          const out = [];
          for (let r = 0; r < nr; r++) {
            const src = data()[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < nc; c++) {
              const v = src[col - 1 + c];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setValues(vals) {
          vals.forEach((line, r) => {
            const idx = row - 1 + r;
            while (data().length <= idx) data().push([]);
            line.forEach((v, c) => { data()[idx][col - 1 + c] = v; });
          });
          return this;
        },
        setNumberFormat() { return this; },
      };
    },
    deleteRow(r) { data().splice(r - 1, 1); },
  };
}

let dropNext = false;
let failNext = false;
const lockQueue = [];

function makeContext() {
  const ctx = {
    SpreadsheetApp: {
      getActive: () => ({ getSheetByName: (n) => (sheets[n] ? makeSheet(n) : null) }),
      flush() {},
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GYM_SECRET' ? SECRET : null) }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
    console,
    Date, JSON, Math, Number, String, Array, Object, RegExp, isFinite,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return ctx;
}

/* ---------- Сервер эмулятора Apps Script ---------- */

const cors = { 'Access-Control-Allow-Origin': '*' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${GAS_PORT}`);
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (url.pathname === '/admin/state') {
      const count = (n) => sheets[n].length - 1;
      const ids = sheets.Sessions.slice(1).map((r) => r[0]);
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      return res.end(JSON.stringify({ log: count('Log'), sessions: count('Sessions'), bodyweight: count('Bodyweight'), sessionIds: ids, sheets }, null, 1));
    }
    if (url.pathname === '/admin/reset') { reset(); res.writeHead(200, cors); return res.end('ok'); }
    if (url.pathname === '/admin/drop-next') { dropNext = true; res.writeHead(200, cors); return res.end('ok'); }
    if (url.pathname === '/admin/fail-next') { failNext = true; res.writeHead(200, cors); return res.end('ok'); }
    if (url.pathname !== '/exec') { res.writeHead(404, cors); return res.end(); }

    if (failNext) { failNext = false; res.writeHead(500, cors); return res.end('fail'); }
    const ctx = makeContext();
    let out;
    if (req.method === 'POST') {
      out = ctx.doPost({ postData: { contents: body, type: req.headers['content-type'] } });
    } else {
      out = ctx.doGet({ parameter: Object.fromEntries(url.searchParams) });
    }
    if (dropNext) {
      // Запрос обработан, но ответ «потерялся» — клиент обязан повторить, сервер не должен задвоить.
      dropNext = false;
      console.log('[gas] response dropped on purpose');
      return req.socket.destroy();
    }
    console.log('[gas]', req.method, body ? JSON.parse(body).action : 'GET', '→', out.content.slice(0, 80));
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(out.content);
  });
}).listen(GAS_PORT, () => console.log(`Apps Script emulator: http://localhost:${GAS_PORT}/exec  (secret: ${SECRET})`));

/* ---------- Статика ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${APP_PORT}`);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || p.startsWith('/dev/') || p.startsWith('/apps-script/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(APP_PORT, () => console.log(`App: http://localhost:${APP_PORT}/`));
