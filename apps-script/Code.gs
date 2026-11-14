/**
 * Gym Log — мост между PWA и Google Таблицей.
 *
 * Скрипт привязан к таблице (Расширения → Apps Script).
 * Секрет НЕ хранится в коде: Project Settings → Script Properties → GYM_SECRET.
 *
 * Протокол: POST, тело — JSON-строка (Content-Type: text/plain, чтобы не было CORS preflight).
 *   { secret, action: "ping" }                     → { ok, service }
 *   { secret, action: "getProgram" }               → { ok, program: [...], exercises: [...] }
 *   { secret, action: "saveWorkout", workout: {} } → { ok, duplicate, sets }
 * doGet(?secret=...) тоже отдаёт программу (для ручной проверки); приложение ходит через POST,
 * чтобы секрет не попадал в URL.
 */

var SHEETS = {
  log: 'Log',
  sessions: 'Sessions',
  program: 'Program',
  bodyweight: 'Bodyweight',
  exercises: 'Exercises'
};

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function doGet(e) {
  var secret = e && e.parameter ? e.parameter.secret : '';
  if (!checkSecret_(secret)) return json_({ ok: false, error: 'unauthorized' });
  return json_(withOk_(getProgram_()));
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  if (!body || !checkSecret_(body.secret)) return json_({ ok: false, error: 'unauthorized' });

  try {
    switch (body.action) {
      case 'ping':
        return json_({ ok: true, service: 'gym-log' });
      case 'getProgram':
        return json_(withOk_(getProgram_()));
      case 'saveWorkout':
        return json_(saveWorkout_(body.workout));
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

/* ---------- Программа ---------- */

function getProgram_() {
  var ss = SpreadsheetApp.getActive();
  return {
    program: readObjects_(ss.getSheetByName(SHEETS.program)),
    exercises: readObjects_(ss.getSheetByName(SHEETS.exercises)),
    fetched_at: new Date().toISOString()
  };
}

/* ---------- Приём тренировки (идемпотентно по workout_id) ---------- */

function saveWorkout_(w) {
  if (!w || !UUID_RE.test(String(w.workout_id || ''))) return { ok: false, error: 'bad_workout_id' };
  var sets = Array.isArray(w.sets) ? w.sets : [];
  var id = String(w.workout_id);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActive();
    var sessions = ss.getSheetByName(SHEETS.sessions);
    var log = ss.getSheetByName(SHEETS.log);
    var bw = ss.getSheetByName(SHEETS.bodyweight);

    // Сессия пишется последней. Если она уже есть — тренировка принята целиком, повтор игнорируем.
    if (findRows_(sessions, id).length) return { ok: true, duplicate: true, sets: sets.length };

    // Сессии нет: возможно, прошлая попытка оборвалась на середине. Убираем её хвосты.
    deleteRows_(log, findRows_(log, id));
    deleteRows_(bw, findRows_(bw, id));

    var date = toDate_(w.date);
    var logRows = sets.map(function (s) {
      return {
        workout_id: id,
        date: date,
        day_type: w.day_type,
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        order: s.order,
        set_no: s.set_no,
        is_warmup: !!s.is_warmup,
        weight_kg: num_(s.weight_kg),
        is_bodyweight: !!s.is_bodyweight,
        added_kg: s.is_bodyweight ? num_(s.added_kg) : '',
        reps: num_(s.reps),
        done: !!s.done,
        rir: s.rir === null || s.rir === undefined ? '' : num_(s.rir),
        created_at: s.created_at || w.end || ''
      };
    });
    appendObjects_(log, logRows);

    if (w.bodyweight_kg) {
      appendObjects_(bw, [{ date: date, weight_kg: num_(w.bodyweight_kg), workout_id: id }]);
    }

    appendObjects_(sessions, [{
      workout_id: id,
      date: date,
      start: w.start || '',
      end: w.end || '',
      duration_min: num_(w.duration_min),
      day_type: w.day_type,
      title: w.title,
      feel_1_5: num_(w.feel_1_5),
      sleep_1_5: num_(w.sleep_1_5),
      food_1_3: num_(w.food_1_3),
      mood_1_5: num_(w.mood_1_5),
      back_ok: w.back_ok === null || w.back_ok === undefined ? '' : !!w.back_ok,
      comment: w.comment || '',
      bodyweight_kg: w.bodyweight_kg ? num_(w.bodyweight_kg) : '',
      volume_kg: num_(w.volume_kg),
      volume_work_kg: num_(w.volume_work_kg),
      sets: num_(w.sets_count),
      reps: num_(w.reps_count),
      prs_json: w.prs_json || '[]',
      app_version: w.app_version || ''
    }]);

    SpreadsheetApp.flush();
    return { ok: true, duplicate: false, sets: logRows.length };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Утилиты ---------- */

function checkSecret_(given) {
  var expected = PropertiesService.getScriptProperties().getProperty('GYM_SECRET');
  if (!expected || !given) return false;
  given = String(given);
  if (given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function headers_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

function readObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) {
      var o = {};
      head.forEach(function (h, i) {
        if (!h) return;
        var v = row[i];
        o[h] = v instanceof Date ? v.toISOString() : v;
      });
      return o;
    });
}

function appendObjects_(sheet, objects) {
  if (!objects.length) return;
  var head = headers_(sheet);
  var rows = objects.map(function (o) {
    return head.map(function (h) { return h in o ? safeCell_(o[h]) : ''; });
  });
  var start = sheet.getLastRow() + 1;
  var range = sheet.getRange(start, 1, rows.length, head.length);
  var idCol = head.indexOf('workout_id');
  if (idCol >= 0) sheet.getRange(start, idCol + 1, rows.length, 1).setNumberFormat('@');
  range.setValues(rows);
}

/** Номера строк (1-based), где в колонке workout_id стоит id. */
function findRows_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var col = headers_(sheet).indexOf('workout_id');
  if (col < 0) return [];
  var vals = sheet.getRange(2, col + 1, last - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === id) out.push(i + 2);
  return out;
}

function deleteRows_(sheet, rows) {
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); });
}

/** Текст не должен превратиться в формулу. */
function safeCell_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v === undefined || v === null ? '' : v;
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isFinite(n) ? n : '';
}

/** "2026-11-14" → Date в часовом поясе скрипта. */
function toDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : String(s || '');
}

function withOk_(o) {
  o.ok = true;
  return o;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
