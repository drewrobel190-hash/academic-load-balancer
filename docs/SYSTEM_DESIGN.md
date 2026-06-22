# Academic Workload Monitoring and Load Balancing System
### System Design & Architecture Document

> A role-based web application that lets teachers encode academic tasks with
> time-based effort scores and deadlines, computes **per-day workload pressure**
> for each section, and runs an **advisory load-balancing engine** that suggests
> redistributing flexible tasks away from congested days.

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (ES modules, no framework) |
| Auth | Firebase Authentication (email/password) |
| Database | Cloud Firestore |
| Storage | Firebase Storage (profile photos) |
| Charts | Chart.js |
| Calendar | FullCalendar 6 |
| Reports | jsPDF |
| Hosting | Firebase Hosting (static) |

**Architecture:** a multi-page app where every page shares `nav.js` (auth guard,
role resolution, sidebar, theme) and `workload.js` (the single source of truth for
the workload scale, pressure tiers, aggregation, and the balancing algorithm).
`firebase-config.js` is locked and exports only `auth` and `db`; other services
(Storage) are reached through `getApp()`.

---

## 2. Role Hierarchy & Permission Matrix

Three roles with strictly nested data scope (`faculty` is treated as `teacher`).

| Role | Scope | Can do |
|---|---|---|
| **Administrator** | Institution-wide | Manage users & roles, create/delete sections, assign students & teachers, monitor all workloads, see the balancer for every section |
| **Teacher / Faculty** | Their assigned `sectionIds[]` | Create tasks; **edit/delete only tasks they created**; view all tasks in their sections; see section pressure + forecast, use the balancer |
| **Student** | Their single `sectionId` | Read-only view of their section's tasks, personal pressure dashboard, calendar, forecast |

**Permission matrix** (C reate / R ead / U pdate / D elete):

| Collection | Admin | Teacher | Student |
|---|---|---|---|
| `users` | CRUD | R (roster) | R (self), C (self-bootstrap as student) |
| `sections` | CRUD | R | R |
| `tasks` | CRUD | C · R · U/D **own only** | R |
| `taskProgress` | — | — | CRU (self) |
| `settings` | CRUD | R | R |
| `auditLogs` | R | C | — |

Enforced server-side in [`firestore.rules`](../firestore.rules). The UI role checks
in `nav.js` are convenience only — the rules are the real boundary.

---

## 3. Workload Model (the core concept)

### 3.1 Effort scale (time-based, 1–5)
| Score | Meaning |
|---|---|
| 1 | Under 30 minutes |
| 2 | 1–2 hours |
| 3 | 3–4 hours |
| 4 | Full-day effort |
| 5 | Major project / examination |

`taskType` (assignment / quiz / project / exam) is **decoupled** from `effortScore`
— type drives categorization & color; effort drives all pressure math. Choosing a
type pre-fills a sensible effort + flexibility default, both still editable.

### 3.2 Per-day pressure tiers
The system sums `effortScore` for every task due on the same date, then classifies:

| Tier | Daily total | Color |
|---|---|---|
| Low | 0–5 | green |
| Moderate | 6–10 | amber |
| High | 11–15 | orange |
| Critical | 16+ | red |

A task may be assigned to **multiple sections** (`sectionIds[]`); its effort is
counted **separately toward each** section — there is no global pool. A student's
daily load is the sum of their own section's tasks. The dashboard surfaces the
busiest single day over the next 14 days as the **Pressure Level** KPI, and counts
High+ days as the **Burnout Risk** KPI.

All of this lives in [`public/js/workload.js`](../public/js/workload.js).

---

## 4. Smart Load Balancing Engine

The differentiating feature. **Advisory only** — it produces suggestions a teacher
approves; it never silently moves a graded deadline.

### Algorithm (`buildBalancerRecommendations`)
```
1. Group tasks into tracks — one per section (a multi-section task is placed in
   each of its sections' tracks; congestion is evaluated independently per section).
2. For each track, sum effort per day → daily loads.
3. Find congested days (tier High+), worst first.
4. For each congested day:
     take its MOVABLE tasks, smallest effort first
     for each, find the nearest day within +7 days whose load
       stays ≤ Moderate (re-checking so no NEW spike is created)
     record a {from → to} recommendation; update the working loads.
5. Return the recommendation list.
```
- **Smallest-movable-first** relieves the day with the least disruption to students.
- **Re-checking the target** prevents shoving everything onto one rescue day.
- **`movable`** defaults: assignments & projects flexible; quizzes & exams fixed.
- Complexity O(days × tasks) — instant for a section.

### Worked example
`Jun 30` totals **18 pts (Critical)**. The engine emits:
*Move "Programming Project" → Jul 2*, *Move "Database Quiz" → Jul 1*, bringing
`Jun 30` down to **9 pts (Moderate)**. The teacher clicks **Apply** (updates the
deadline) or **drags** the event in the calendar (what-if simulator).

---

## 5. Database Design (Firestore)

```js
// users/{email}
{ role: "student"|"teacher"|"faculty"|"admin",
  sectionId: "sec_x",        // student: one section
  sectionIds: ["sec_x"],     // teacher: many sections
  createdAt: "ISO" }

// sections/{autoId}
{ name: "BSIT 2A", createdAt: "ISO" }

// tasks/{autoId}
{ title, subject,
  taskType: "project",       // assignment|quiz|project|exam
  effortScore: 4,            // 1–5 time scale  (drives pressure)
  workloadScore: 4,          // kept == effortScore for backward compatibility
  movable: true,             // balancer may suggest moving it
  deadline: "2026-06-30",
  deadlineTime: "23:59",
  sectionIds: ["sec_x","sec_y"], // multi-section assignment (≥1 required, no global)
  createdBy: "uid",          // owner — teachers may edit/delete only their own
  createdByEmail: "teacher@…",
  createdAt: "ISO" }

// — planned —
// taskProgress/{uid}/items/{taskId} { done, completedAt }
// settings/global { thresholds:{moderate,high,critical} }
// notifications/{id} { toSection, type, title, body, readBy[] }
// auditLogs/{id} { actor, action, target, before, after, at }
```

**Backward compatibility:** legacy tasks stored only numeric `workloadScore`
(1,2,4,5) and a single `sectionId`. `workload.js` getters (`getEffort`,
`getTaskType`, `isMovable`, `getTaskSections`) read either shape — a legacy
`sectionId:"bsit1"` is read as `["bsit1"]`, so old data keeps working with no
migration. Saving a task rewrites it to `sectionIds[]` and clears `sectionId`.
A legacy task with an empty `sectionId` (an old "global" task) becomes
**Unassigned** — visible to staff (to fix) but counted toward no section.

---

## 6. Dashboards

| Dashboard | KPI cards | Visuals |
|---|---|---|
| **Student** | Total tasks · Pressure (peak day) · Due this week · Burnout risk | 14-day forecast bars · workload-heatmap calendar |
| **Teacher** | same, scoped to their sections | forecast · heatmap · **Smart Load Balancing panel** · drag-to-rebalance |
| **Admin** | Total users · Total tasks · Overdue · High-load | section management · user/role table · at-risk alerts · balancer (all sections) |

The **calendar heatmap** colors each day cell by its pressure tier and shows the
point total inline (`dayCellDidMount` in `dashboard.js`). Teachers/admins get an
`editable` calendar — dragging an event reschedules the deadline live.

---

## 7. File Map

| File | Responsibility |
|---|---|
| `js/workload.js` | Scale, tiers, colors, aggregation, **balancer algorithm** |
| `js/nav.js` | Auth guard, role resolution, sidebar, theme, confirm modals |
| `js/dashboard.js` | KPIs, forecast chart, heatmap calendar, balancer panel, drag |
| `js/tasks.js` | Task CRUD, type/effort/flexible form, grouping, section filters |
| `js/analytics.js` | Workload-by-subject + task-type charts, PDF export |
| `js/admin.js` | User/role management, section CRUD, stats, at-risk alerts |
| `js/profile.js` | Profile, photo upload (Firebase Storage via `getApp()`) |
| `firestore.rules` | Server-side permission matrix |

---

## 8. Setup & Deployment

1. **Apply security rules:** Firebase Console → Firestore → Rules → paste
   [`firestore.rules`](../firestore.rules) → Publish (or `firebase deploy --only firestore:rules`).
2. **Storage rules** (for photo upload): allow authenticated read/write on
   `avatars/{uid}`.
3. **Seed roles:** the first time a user logs in, `nav.js` creates their `users`
   doc as `student`. An admin then promotes teachers/admins and assigns sections
   in the Admin panel.
4. **Bootstrap an admin:** in the Console, set one `users/{email}.role = "admin"`
   manually so there is someone who can manage the rest.

---

## 9. Roadmap (capstone enhancements)

Ranked by impact ÷ effort:

1. ✅ Per-day pressure tiers + workload heatmap
2. ✅ Advisory load-balancing engine + drag-to-rebalance
3. ✅ Server-side role enforcement
4. **Student completion check-off** (`taskProgress`) — done tasks drop off the curve
5. **Real-time updates** — swap `getDocs` for `onSnapshot`
6. **Excel export** (SheetJS) alongside PDF
7. **In-app notifications** — Firestore + a bell badge
8. **Admin threshold configuration** — edit tiers live via `settings/global`
9. **Audit logs** — record every role change

> **Hosting constraint:** static Hosting + client SDK has no server cron/email.
> Scheduled digests need Cloud Functions (Blaze plan); client-side alternatives
> are EmailJS or an on-login "what changed since you were away" digest.
