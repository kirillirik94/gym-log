// Встроенный справочник и шаблон программы — запасной вариант, пока программа
// не загружена из Google Таблицы. Личных весов здесь нет: они приходят из листа Program.

const E = (id, ru, en, type, group, weightStep, progressStep, noFailure = false, backCheck = false, restSec = 90) =>
  ({ id, name_ru: ru, name_en: en, type, muscle_group: group, weight_step_kg: weightStep, progress_step_kg: progressStep,
     no_failure: noFailure, back_check: backCheck, default_rest_sec: restSec });

export const DEFAULT_EXERCISES = [
  E('bench_press', 'Жим штанги лёжа', 'Bench Press', 'barbell', 'chest', 2.5, 2.5, true, false, 180),
  E('smith_squat', 'Присед в Смите', 'Smith Machine Squat', 'machine', 'legs', 2.5, 5, false, true, 150),
  E('pull_up', 'Подтягивания', 'Pull-Up', 'bodyweight', 'back', 2.5, 2.5, false, false, 120),
  E('bar_dip', 'Брусья', 'Bar Dip', 'bodyweight', 'chest', 2.5, 2.5, false, false, 120),
  E('seated_db_press', 'Жим гантелей сидя', 'Seated Dumbbell Shoulder Press', 'dumbbell', 'shoulders', 2, 2, false, false, 90),
  E('barbell_squat', 'Присед со штангой', 'Barbell Back Squat', 'barbell', 'legs', 2.5, 5, true, true, 150),
  E('goblet_squat', 'Кубковый присед', 'Goblet Squat', 'dumbbell', 'legs', 2, 2, false, true, 90),
  E('romanian_deadlift', 'Румынская тяга', 'Romanian Deadlift', 'barbell', 'hamstrings', 2.5, 2.5, false, true, 150),
  E('trap_bar_deadlift', 'Становая с трэп-грифом', 'Trap Bar Deadlift', 'barbell', 'legs', 2.5, 2.5, false, true, 150),
  E('deadlift', 'Становая тяга', 'Deadlift', 'barbell', 'back', 2.5, 2.5, false, true, 180),
  E('db_row', 'Тяга гантели одной рукой', 'One-Arm Dumbbell Row', 'dumbbell', 'back', 2, 2),
  E('lat_pulldown', 'Тяга верхнего блока', 'Lat Pulldown', 'machine', 'back', 5, 5),
  E('seated_cable_row', 'Тяга нижнего блока', 'Seated Cable Row', 'machine', 'back', 5, 5),
  E('incline_db_press', 'Жим гантелей на наклонной', 'Incline Dumbbell Press', 'dumbbell', 'chest', 2, 2),
  E('leg_press', 'Жим ногами', 'Leg Press', 'machine', 'legs', 10, 10, false, false, 120),
  E('db_lunge', 'Выпады с гантелями', 'Dumbbell Lunge', 'dumbbell', 'legs', 2, 2),
  E('lateral_raise', 'Махи гантелями в стороны', 'Lateral Raise', 'dumbbell', 'shoulders', 1, 1, false, false, 60),
  E('face_pull', 'Тяга каната к лицу', 'Face Pull', 'machine', 'shoulders', 2.5, 2.5, false, false, 60),
  E('db_curl', 'Сгибания рук с гантелями', 'Dumbbell Curl', 'dumbbell', 'arms', 1, 1, false, false, 60),
  E('triceps_pushdown', 'Разгибания рук на блоке', 'Triceps Pushdown', 'machine', 'arms', 2.5, 2.5, false, false, 60),
  E('hanging_knee_raise', 'Подъём коленей в висе', 'Hanging Knee Raise', 'bodyweight', 'core', 2.5, 2.5, false, false, 60),
  E('back_extension', 'Гиперэкстензия', 'Back Extension', 'bodyweight', 'back', 2.5, 2.5, false, true, 60),
];

const P = (day, order, id, sets, min, max, rest, superset = '') =>
  ({ day, order, exercise_id: id, sets, rep_min: min, rep_max: max, rest_sec: rest, superset, start_sets: '' });

export const DEFAULT_PROGRAM = [
  P('A', 1, 'bench_press', 4, 6, 10, 180),
  P('A', 2, 'smith_squat', 3, 8, 12, 150),
  P('A', 3, 'pull_up', 4, 6, 10, 120, 'S1'),
  P('A', 4, 'bar_dip', 3, 10, 15, 120, 'S1'),
  P('A', 5, 'seated_db_press', 3, 8, 12, 90),
  P('B', 1, 'barbell_squat', 3, 5, 8, 120),
  P('B', 2, 'romanian_deadlift', 3, 8, 10, 120),
  P('B', 3, 'pull_up', 3, 5, 8, 90, 'S1'),
  P('B', 4, 'bar_dip', 3, 10, 12, 90, 'S1'),
];
