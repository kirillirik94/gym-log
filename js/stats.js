// Объём, рекорды, сравнения, факты, XP, стрик, ачивки. Без DOM.
import { weekKey, addDays, clean, parseYmd } from './util.js';

export const e1rm = (w, r) => (w > 0 && r > 0 ? (r === 1 ? w : w * (1 + r / 30)) : 0);

// Упражнения, где поднимается почти весь вес тела. У остальных (подъём ног, гиперэкстензия) в объём идёт только доп. вес.
const FULL_BW = new Set(['pull_up', 'bar_dip', 'chin_up', 'push_up']);

/** Нагрузка подхода: для подтягиваний и брусьев — вес тела (если известен) + доп. кг. */
export function setLoad(set, ex, bw) {
  if (ex?.type === 'bodyweight') return (FULL_BW.has(ex.id) ? bw || 0 : 0) + (set.weight || 0);
  return set.weight || 0;
}

const workSets = (e) => e.sets.filter((s) => s.done && !s.warmup);

export function computeSummary(w, history, program, bw) {
  let volume = 0, volumeWork = 0, nWork = 0, nWarm = 0, reps = 0, maxWeight = 0;
  const perExercise = [];
  for (const e of w.exercises) {
    if (e.skipped) continue;
    const ex = program.exercises[e.exerciseId];
    let v = 0, r = 0, n = 0, wsum = 0, top = 0, best1 = 0;
    for (const s of e.sets) {
      if (!s.done) continue;
      const load = setLoad(s, ex, bw);
      volume += load * s.reps;
      if (s.warmup) { nWarm++; continue; }
      volumeWork += load * s.reps;
      v += load * s.reps; r += s.reps; n++; wsum += s.weight;
      top = Math.max(top, s.weight);
      if (ex?.type !== 'bodyweight') { maxWeight = Math.max(maxWeight, s.weight); best1 = Math.max(best1, e1rm(s.weight, s.reps)); }
    }
    nWork += n; reps += r;
    if (n) perExercise.push({ exerciseId: e.exerciseId, volume: clean(v), reps: r, sets: n, avgWeight: clean(wsum / n), topWeight: top, e1rm: clean(best1) });
  }
  const prs = findPRs(w, history, program);
  const prev = [...history].reverse().find((h) => h.day === w.day && h.id !== w.id && h.summary);
  let compare = null;
  if (prev) {
    const p = prev.summary;
    compare = {
      prevId: prev.id,
      volumeWork: [clean(volumeWork), p.volumeWork],
      workSets: [nWork, p.workSets],
      reps: [reps, p.reps],
      maxWeight: [maxWeight, p.maxWeight],
      perExercise: Object.fromEntries(perExercise.map((pe) => {
        const q = p.perExercise.find((x) => x.exerciseId === pe.exerciseId);
        return [pe.exerciseId, q ? { volume: q.volume, topWeight: q.topWeight, reps: q.reps, avgWeight: q.avgWeight } : null];
      })),
    };
  }
  return {
    volume: clean(volume), volumeWork: clean(volumeWork), workSets: nWork, warmupSets: nWarm, reps, maxWeight,
    perExercise, prs, compare, bw: bw || null,
  };
}

/** Базовые записи из start_sets (реальные веса на старте) — чтобы первая тренировка не была «сплошь рекордами». */
function baselineSets(program, exerciseId) {
  const out = [];
  for (const day of Object.values(program.days)) {
    for (const pe of day) if (pe.exerciseId === exerciseId) for (const s of pe.startSets) if (!s.warmup) out.push(s);
  }
  return out;
}

export function findPRs(w, history, program) {
  const prs = [];
  for (const e of w.exercises) {
    if (e.skipped) continue;
    const cur = workSets(e);
    if (!cur.length) continue;
    const ex = program.exercises[e.exerciseId];
    const isBW = ex?.type === 'bodyweight';
    const prior = [...baselineSets(program, e.exerciseId)];
    for (const h of history) {
      if (h.id === w.id) continue;
      for (const he of h.exercises) if (he.exerciseId === e.exerciseId && !he.skipped) prior.push(...workSets(he));
    }
    if (!prior.length) continue; // первый раз — не рекорд, а начало

    const pMax = Math.max(...prior.map((s) => s.weight));
    const cMax = Math.max(...cur.map((s) => s.weight));
    if (cMax > pMax && (!isBW || cMax > 0)) prs.push({ exerciseId: e.exerciseId, type: 'weight', value: cMax });

    // Повторы на весе: больше повторов, чем когда-либо при таком же или большем весе.
    let bestRep = null;
    for (const s of cur) {
      const atLeast = prior.filter((p) => p.weight >= s.weight);
      const pr = atLeast.length ? Math.max(...atLeast.map((p) => p.reps)) : 0;
      if (atLeast.length && s.reps > pr && (!bestRep || s.weight > bestRep.weight)) bestRep = { weight: s.weight, reps: s.reps };
    }
    if (bestRep) prs.push({ exerciseId: e.exerciseId, type: 'reps', value: bestRep.reps, weight: bestRep.weight, reps: bestRep.reps });

    if (!isBW) {
      const p1 = Math.max(...prior.map((s) => e1rm(s.weight, s.reps)));
      const c1 = Math.max(...cur.map((s) => e1rm(s.weight, s.reps)));
      if (c1 > p1 + 0.01) prs.push({ exerciseId: e.exerciseId, type: 'e1rm', value: clean(c1) });
    }
  }
  return prs;
}

/* ---------- XP и уровни ---------- */

export function workoutXp(summary) {
  return 100 + 5 * summary.workSets + 30 * summary.prs.length;
}

export function levelFromXp(xp) {
  let level = 1, need = 300, rem = xp;
  while (rem >= need) { rem -= need; level++; need += 100; }
  return { level, into: rem, need };
}

/* ---------- Стрик по неделям ---------- */

export function weeklyStreak(history, target, now = Date.now()) {
  const counts = {};
  for (const w of history) { const k = weekKey(w.startedAt); counts[k] = (counts[k] || 0) + 1; }
  const thisWeek = weekKey(now);
  let streak = 0;
  let cursor = (counts[thisWeek] || 0) >= target ? now : addDays(now, -7);
  while ((counts[weekKey(cursor)] || 0) >= target) { streak++; cursor = addDays(cursor, -7); }
  // лучший стрик
  const keys = Object.keys(counts).sort();
  let best = 0;
  if (keys.length) {
    let run = 0;
    let t = parseYmd(keys[0]).getTime();
    let k = weekKey(t);
    let guard = 0;
    while (parseYmd(k).getTime() <= now && guard++ < 1000) {
      run = (counts[k] || 0) >= target ? run + 1 : 0;
      best = Math.max(best, run);
      t = addDays(t, 7); k = weekKey(t);
    }
  }
  return { streak, thisWeek: counts[thisWeek] || 0, target, best: Math.max(best, streak) };
}

/* ---------- Ачивки ---------- */

export const ACHIEVEMENTS = [
  'first_workout', 'workouts_10', 'workouts_50', 'workouts_100', 'bench_100', 'bench_bw', 'first_free_squat',
  'free_squat_60', 'weighted_pullup', 'weighted_dip', 'first_pr', 'prs_10', 'volume_10t', 'full_week',
  'streak_4', 'streak_10', 'back_ok_5',
];

export function computeAchievements(history, target) {
  const got = {};
  const give = (id, w) => { if (!got[id]) got[id] = { date: w.startedAt, workoutId: w.id }; };
  let n = 0, prs = 0, backOk = 0;
  const weekCounts = {};
  for (const w of history) {
    n++;
    if (n >= 1) give('first_workout', w);
    if (n >= 10) give('workouts_10', w);
    if (n >= 50) give('workouts_50', w);
    if (n >= 100) give('workouts_100', w);
    const s = w.summary || { prs: [], volumeWork: 0 };
    prs += s.prs.length;
    if (s.prs.length) give('first_pr', w);
    if (prs >= 10) give('prs_10', w);
    if (s.volumeWork >= 10000) give('volume_10t', w);
    if (w.ratings?.backOk === true) { backOk++; if (backOk >= 5) give('back_ok_5', w); }
    const bw = s.bw;
    for (const e of w.exercises) {
      if (e.skipped) continue;
      const ws = workSets(e);
      if (!ws.length) continue;
      const top = Math.max(...ws.map((x) => x.weight));
      if (e.exerciseId === 'bench_press' && top >= 100) give('bench_100', w);
      if (e.exerciseId === 'bench_press' && bw && top >= bw) give('bench_bw', w);
      if (e.exerciseId === 'barbell_squat') give('first_free_squat', w);
      if (e.exerciseId === 'barbell_squat' && top >= 60) give('free_squat_60', w);
      if (e.exerciseId === 'pull_up' && top > 0) give('weighted_pullup', w);
      if (e.exerciseId === 'bar_dip' && top > 0) give('weighted_dip', w);
    }
    const k = weekKey(w.startedAt);
    weekCounts[k] = (weekCounts[k] || 0) + 1;
    if (weekCounts[k] >= target) give('full_week', w);
    const st = weeklyStreak(history.filter((h) => h.startedAt <= w.startedAt), target, w.startedAt).streak;
    if (st >= 4) give('streak_4', w);
    if (st >= 10) give('streak_10', w);
  }
  return got;
}

/* ---------- Мотивирующие факты ---------- */

// Распространённые таблицы силовых нормативов (мужчины, e1RM / вес тела). Ориентир, а не точная наука.
export const STANDARDS = {
  bench_press: [0.5, 1.0, 1.5, 2.0],
  barbell_squat: [0.75, 1.25, 1.75, 2.5],
  deadlift: [1.0, 1.5, 2.0, 2.75],
  trap_bar_deadlift: [1.0, 1.5, 2.0, 2.75],
};
export const LEVELS = ['novice', 'intermediate', 'advanced', 'elite'];

export function strengthLevel(exerciseId, e1, bw) {
  const st = STANDARDS[exerciseId];
  if (!st || !bw || !e1) return null;
  const ratio = e1 / bw;
  let idx = -1;
  for (let i = 0; i < st.length; i++) if (ratio >= st[i]) idx = i;
  const next = idx + 1 < st.length ? { level: LEVELS[idx + 1], needKg: clean(st[idx + 1] * bw - e1) } : null;
  return { ratio: clean(ratio), level: idx >= 0 ? LEVELS[idx] : null, next };
}

// Массы приблизительные.
const OBJECTS_WORKOUT = [
  { key: 'piano', kg: 400 },
  { key: 'car', kg: 1500 },
  { key: 'elephant', kg: 6000 },
  { key: 'bus', kg: 12000 },
];
const OBJECTS_MONTH = [
  { key: 'b737', kg: 41000 },
  { key: 'whale', kg: 150000 },
];

/** Кандидаты-факты: [{id, key, params}] */
export function factCandidates(w, history, program, target = 3, now = Date.now()) {
  const s = w.summary;
  const out = [];
  const bw = s.bw;
  for (const pe of s.perExercise) {
    const lvl = strengthLevel(pe.exerciseId, pe.e1rm, bw);
    if (lvl) out.push({ id: `std_${pe.exerciseId}`, key: 'fact_standard', params: { ex: pe.exerciseId, e1rm: pe.e1rm, ratio: lvl.ratio, level: lvl.level, next: lvl.next } });
  }
  for (const o of OBJECTS_WORKOUT) {
    const x = s.volume / o.kg;
    if (x >= 1 && x <= 30) out.push({ id: `vol_${o.key}`, key: 'fact_volume', params: { obj: o.key, count: Math.round(x * 10) / 10, tons: Math.round(s.volume / 100) / 10 } });
  }
  const all = [...history.filter((h) => h.id !== w.id), w];
  const month = all.filter((h) => h.startedAt >= addDays(now, -30));
  const mVol = month.reduce((a, h) => a + (h.summary?.volume || 0), 0);
  for (const o of OBJECTS_MONTH) {
    const x = mVol / o.kg;
    if (x >= 0.3) out.push({ id: `month_${o.key}`, key: 'fact_month', params: { obj: o.key, count: Math.round(x * 10) / 10, tons: Math.round(mVol / 100) / 10 } });
  }
  // Личная динамика: сравнение с самой ранней записью не моложе 14 дней.
  for (const pe of s.perExercise) {
    const ex = program.exercises[pe.exerciseId];
    if (!ex || ex.type === 'bodyweight') continue;
    const old = all.find((h) => h.startedAt <= addDays(now, -14) && h.summary?.perExercise.some((x) => x.exerciseId === pe.exerciseId));
    if (!old) continue;
    const then = old.summary.perExercise.find((x) => x.exerciseId === pe.exerciseId).topWeight;
    const delta = clean(pe.topWeight - then);
    const days = Math.round((now - old.startedAt) / 86400000);
    if (delta > 0) out.push({ id: `dyn_${pe.exerciseId}`, key: 'fact_dynamics', params: { ex: pe.exerciseId, delta, days } });
  }
  const streak = weeklyStreak(all, target, now);
  if (streak.streak >= 2) out.push({ id: 'streak', key: 'fact_streak', params: { weeks: streak.streak } });
  const total = all.reduce((a, h) => a + (h.summary?.volume || 0), 0);
  if (all.length >= 3) out.push({ id: 'lifetime', key: 'fact_lifetime', params: { tons: clean(total / 1000), n: all.length } });
  out.push({ id: `reps_${s.reps}`, key: 'fact_reps', params: { reps: s.reps, sets: s.workSets } });
  return out;
}

/** Выбор факта, которого давно не было. shown — id последних показанных. */
export function pickFact(cands, shown = [], rnd = Math.random) {
  const fresh = cands.filter((c) => !shown.includes(c.id));
  const pool = fresh.length ? fresh : cands;
  return pool[Math.floor(rnd() * pool.length)] || null;
}
