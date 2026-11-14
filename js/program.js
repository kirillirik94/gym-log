// Нормализация программы из листов Program / Exercises.
import { DEFAULT_EXERCISES, DEFAULT_PROGRAM } from './catalog.js';
import { toBool, toNum } from './util.js';

export const TYPE_DEFAULT_STEP = { barbell: 2.5, dumbbell: 2, machine: 2.5, bodyweight: 2.5 };

/** "w40x10, 60x8, 62,5x6" → [{warmup, weight, reps}] */
export function parseStartSets(str) {
  const s = String(str ?? '').trim();
  if (!s) return [];
  return s
    .split(/\s*;\s*|,\s+|\s*\|\s*/)
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok) => {
      const m = /^(w)?\s*([\d.,]+)\s*[x×х*]\s*(\d+)$/i.exec(tok);
      if (!m) return null;
      return { warmup: !!m[1], weight: toNum(m[2]), reps: Number(m[3]) };
    })
    .filter(Boolean);
}

function normExercise(r) {
  const type = ['barbell', 'dumbbell', 'machine', 'bodyweight'].includes(r.type) ? r.type : 'machine';
  return {
    id: String(r.id).trim(),
    name: { ru: r.name_ru || r.name_en || r.id, en: r.name_en || r.name_ru || r.id },
    type,
    group: r.muscle_group || '',
    weightStep: toNum(r.weight_step_kg, TYPE_DEFAULT_STEP[type]),
    progressStep: toNum(r.progress_step_kg, toNum(r.weight_step_kg, TYPE_DEFAULT_STEP[type])),
    noFailure: toBool(r.no_failure),
    backCheck: toBool(r.back_check),
    restSec: toNum(r.default_rest_sec, 90),
    notes: { ru: r.notes_ru || '', en: r.notes_en || '' },
  };
}

/**
 * raw = { program: [...rows], exercises: [...rows], fetched_at }
 * → { exercises: {id: ex}, days: {A: [...], B: [...]}, fetchedAt, source }
 */
export function normalizeProgram(raw, source = 'sheet') {
  const exRows = raw?.exercises?.length ? raw.exercises : DEFAULT_EXERCISES;
  const exercises = {};
  for (const r of DEFAULT_EXERCISES) exercises[r.id] = normExercise(r);
  for (const r of exRows) if (r && r.id) exercises[String(r.id).trim()] = normExercise(r);

  const rows = raw?.program?.length ? raw.program : DEFAULT_PROGRAM;
  const days = {};
  for (const r of rows) {
    const day = String(r.day || '').trim().toUpperCase();
    const id = String(r.exercise_id || '').trim();
    if (!day || !id) continue;
    if (!exercises[id]) {
      exercises[id] = normExercise({ id, name_ru: id, name_en: id, type: 'machine' });
    }
    const ex = exercises[id];
    (days[day] ||= []).push({
      exerciseId: id,
      order: toNum(r.order, 99),
      sets: Math.max(1, toNum(r.sets, 3)),
      repMin: toNum(r.rep_min, 8),
      repMax: Math.max(toNum(r.rep_min, 8), toNum(r.rep_max, 12)),
      restSec: toNum(r.rest_sec, ex.restSec),
      superset: String(r.superset || '').trim(),
      startSets: parseStartSets(r.start_sets),
      notes: { ru: r.notes_ru || '', en: r.notes_en || '' },
    });
  }
  for (const d of Object.keys(days)) days[d].sort((a, b) => a.order - b.order);
  return { exercises, days, fetchedAt: raw?.fetched_at || null, source };
}

export function exName(ex, lang) {
  if (!ex) return '?';
  return ex.name[lang] || ex.name.ru;
}

/** Шаг кнопок +/−: настройка пользователя → лист Exercises → тип. */
export function weightStepFor(ex, settings) {
  const o = settings?.weightSteps?.[ex.id];
  if (o) return o;
  return ex.weightStep || TYPE_DEFAULT_STEP[ex.type] || 2.5;
}
