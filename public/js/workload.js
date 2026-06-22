/* ════════════════════════════════════════════════════════════════
   workload.js — single source of truth for the load-balancing system
   ----------------------------------------------------------------
   Every page imports from here so the scale, tiers, colors, per-day
   aggregation and the balancing algorithm exist in exactly one place.

   Backward compatible: old tasks stored only `workloadScore` (1,2,4,5).
   New tasks store `taskType` + `effortScore` (+ `movable`). The getters
   below transparently read either shape.
═══════════════════════════════════════════════════════════════════ */

/* ── Task types (category + color + sensible defaults) ── */
export const TASK_TYPES = [
  { value:"assignment", label:"Assignment", defaultEffort:2, color:"#3b82f6", border:"#1d4ed8", movable:true  },
  { value:"quiz",       label:"Quiz",       defaultEffort:2, color:"#14b8a6", border:"#0d9488", movable:false },
  { value:"project",    label:"Project",    defaultEffort:4, color:"#f59e0b", border:"#d97706", movable:true  },
  { value:"exam",       label:"Exam",       defaultEffort:5, color:"#ef4444", border:"#dc2626", movable:false }
];

const TYPE_BY_VALUE = Object.fromEntries(TASK_TYPES.map((t) => [t.value, t]));
const TYPE_BY_SCORE = { 1:"assignment", 2:"quiz", 4:"project", 5:"exam" }; // legacy mapping

/* ── Effort scale (time-based, 1–5) ── */
export const EFFORT_SCALE = [
  { value:1, label:"1 — under 30 minutes" },
  { value:2, label:"2 — 1 to 2 hours"     },
  { value:3, label:"3 — 3 to 4 hours"     },
  { value:4, label:"4 — full-day effort"  },
  { value:5, label:"5 — major project / exam" }
];

/* ── Pressure tiers (PER-DAY total effort) ── */
export const PRESSURE_TIERS = [
  { id:"low",      label:"Low",      level:0, min:0,  max:5,        color:"#16a34a", soft:"rgba(22,163,74,0.16)"  },
  { id:"moderate", label:"Moderate", level:1, min:6,  max:10,       color:"#f59e0b", soft:"rgba(245,158,11,0.18)" },
  { id:"high",     label:"High",     level:2, min:11, max:15,       color:"#f97316", soft:"rgba(249,115,22,0.22)" },
  { id:"critical", label:"Critical", level:3, min:16, max:Infinity, color:"#ef4444", soft:"rgba(239,68,68,0.24)"  }
];

/** A day is "congested" at High level and above. */
export const CONGESTION_LEVEL = 2;
/** Aim to bring relieved days down to at most Moderate. */
export const MODERATE_CEILING = 10;

export function classifyPressure(score){
  const s = Number(score) || 0;
  return PRESSURE_TIERS.find((t) => s >= t.min && s <= t.max) || PRESSURE_TIERS[0];
}

/* ── Task field getters (read new OR legacy shape) ── */
export function getTaskType(task){
  if(task.taskType && TYPE_BY_VALUE[task.taskType]) return task.taskType;
  return TYPE_BY_SCORE[Number(task.workloadScore)] || "assignment";
}

export function typeMeta(task){
  return TYPE_BY_VALUE[getTaskType(task)] || TASK_TYPES[0];
}

export function getEffort(task){
  if(task.effortScore != null && !Number.isNaN(Number(task.effortScore)))  return Number(task.effortScore);
  if(task.workloadScore != null && !Number.isNaN(Number(task.workloadScore))) return Number(task.workloadScore);
  return typeMeta(task).defaultEffort;
}

export function isMovable(task){
  if(typeof task.movable === "boolean") return task.movable;
  return typeMeta(task).movable;
}

/**
 * The sections a task belongs to, as a string array.
 * Backward compatible: prefers the new `sectionIds` array, falls back to a
 * legacy single `sectionId`, and returns [] for an unassigned task.
 *   { sectionIds:["bsit1","bsit2"] } -> ["bsit1","bsit2"]
 *   { sectionId:"bsit1" }            -> ["bsit1"]
 *   { }                              -> []   (unassigned — counts for no section)
 */
export function getTaskSections(task){
  if(Array.isArray(task.sectionIds)){
    const ids = task.sectionIds.filter((s) => typeof s === "string" && s);
    if(ids.length) return [...new Set(ids)];
  }
  if(task.sectionId) return [task.sectionId];
  return [];
}

/* ── Date helpers ── */
export function startOfDay(d = new Date()){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
export function parseYMD(s){ return new Date(`${s}T00:00:00`); }
export function formatYMD(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function daysFromToday(deadline){
  if(!deadline) return Infinity;
  return Math.round((parseYMD(deadline) - startOfDay()) / 86400000);
}
export function shortDate(s){
  return parseYMD(s).toLocaleDateString(undefined, { month:"short", day:"numeric" });
}

/* ── Aggregation ── */

/** Simple per-day total effort across a task list. */
export function buildDailyLoads(tasks){
  const map = {};
  tasks.forEach((t) => {
    if(!t.deadline) return;
    map[t.deadline] = (map[t.deadline] || 0) + getEffort(t);
  });
  return map;
}

/**
 * Per-section daily totals. A task counts SEPARATELY toward each of its
 * sections (no global pooling). Returns { sectionId: { date: load } }.
 */
export function sectionDailyLoads(tasks){
  const bySection = {};
  tasks.forEach((t) => {
    if(!t.deadline) return;
    const e = getEffort(t);
    getTaskSections(t).forEach((sid) => {
      (bySection[sid] ||= {});
      bySection[sid][t.deadline] = (bySection[sid][t.deadline] || 0) + e;
    });
  });
  return bySection;
}

/**
 * Busiest single section per day ("where's the fire"). For a student
 * filtered to one section this is just that student's real daily load.
 * Multi-section tasks count once per section, never pooled globally.
 */
export function peakDailyLoads(tasks){
  const bySection = sectionDailyLoads(tasks);
  const out = {};
  Object.values(bySection).forEach((days) => {
    Object.entries(days).forEach(([d, load]) => {
      if(load > (out[d] || 0)) out[d] = load;
    });
  });
  return out;
}

/** The next `count` calendar days (incl. today) as YYYY-MM-DD strings. */
export function nextDays(count = 14, from = new Date()){
  const t0 = startOfDay(from);
  return Array.from({ length: count }, (_, i) => formatYMD(addDays(t0, i)));
}

/* ════════════════════════════════════════════════════════════════
   SMART LOAD BALANCING ENGINE
   ----------------------------------------------------------------
   Greedy, smallest-movable-first redistribution. Operates per "track"
   (a section, or the global pool). For each congested (High+) day it
   pushes the smallest movable tasks forward to the nearest day that
   stays within Moderate, re-checking the target so it never creates a
   new spike. Exams & quizzes default to fixed (movable:false).

   ADVISORY ONLY — returns suggestions; the teacher applies them.
═══════════════════════════════════════════════════════════════════ */
export function buildBalancerRecommendations(tasks, opts = {}){
  const { maxShiftDays = 7, moderateCeiling = MODERATE_CEILING } = opts;
  const t0   = startOfDay();
  const recs = [];
  const movedTaskIds = new Set();   // a task is suggested for a move at most once

  // group tasks into per-section tracks; a multi-section task appears in each
  const tracks = {};
  tasks.forEach((t) => {
    if(!t.deadline) return;
    getTaskSections(t).forEach((sid) => { (tracks[sid] ||= []).push(t); });
  });

  // worst-congested sections first so the busiest track gets first pick
  const orderedTracks = Object.entries(tracks).sort((a, b) => {
    const peak = (list) => Math.max(0, ...sumByDay(list));
    return peak(b[1]) - peak(a[1]);
  });

  for(const [sectionId, list] of orderedTracks){
    // daily totals for THIS section only
    const loads = {};
    list.forEach((t) => { loads[t.deadline] = (loads[t.deadline] || 0) + getEffort(t); });

    // congested days, today or later, worst first
    const congested = Object.keys(loads)
      .filter((d) => parseYMD(d) >= t0 && classifyPressure(loads[d]).level >= CONGESTION_LEVEL)
      .sort((a, b) => loads[b] - loads[a]);

    for(const day of congested){
      const movable = list
        .filter((t) => t.deadline === day && isMovable(t) && !movedTaskIds.has(t.id))
        .sort((a, b) => getEffort(a) - getEffort(b)); // smallest first

      for(const task of movable){
        if(classifyPressure(loads[day]).level < CONGESTION_LEVEL) break; // day relieved
        const eff    = getEffort(task);
        const before = loads[day];
        const target = findTargetDay(loads, day, eff, maxShiftDays, moderateCeiling);
        if(!target) continue;

        loads[day]    -= eff;
        loads[target]  = (loads[target] || 0) + eff;
        movedTaskIds.add(task.id);

        recs.push({
          taskId:   task.id,
          title:    task.title || "Untitled",
          sectionId,                                  // the section that triggered this
          type:     getTaskType(task),
          effort:   eff,
          from:     day,
          to:       target,
          fromTier: classifyPressure(before).label,
          fromLoad: before,
          reason:   `${shortDate(day)} reached ${classifyPressure(before).label} (${before} pts). Move “${task.title}” (+${eff}) to ${shortDate(target)} to ease the day.`
        });
      }
    }
  }

  return recs;
}

function sumByDay(list){
  const loads = {};
  list.forEach((t) => { loads[t.deadline] = (loads[t.deadline] || 0) + getEffort(t); });
  return Object.values(loads);
}

function findTargetDay(loads, fromDay, eff, maxShiftDays, ceiling){
  const base = parseYMD(fromDay);
  let lightest = null;
  let lightestLoad = Infinity;

  for(let i = 1; i <= maxShiftDays; i++){
    const cand = formatYMD(addDays(base, i));
    const load = loads[cand] || 0;
    if(load + eff <= ceiling) return cand;          // first comfortable day wins
    if(load < lightestLoad){ lightestLoad = load; lightest = cand; }
  }
  return lightest;                                   // fallback: lightest in window
}
