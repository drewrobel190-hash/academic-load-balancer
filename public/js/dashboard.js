import { db } from "./firebase-config.js";
import { initNav, showConfirmModal } from "./nav.js";

import {
  collection,
  getDocs,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  PRESSURE_TIERS,
  CONGESTION_LEVEL,
  classifyPressure,
  typeMeta,
  getEffort,
  getTaskType,
  getTaskSections,
  peakDailyLoads,
  buildBalancerRecommendations,
  nextDays,
  formatYMD,
  parseYMD,
  shortDate,
  daysFromToday
} from "./workload.js";

/* ── DOM refs ── */
const totalTasksEl     = document.getElementById("totalTasks");
const pressureLevelEl  = document.getElementById("pressureLevel");
const deadlinesEl      = document.getElementById("deadlines");
const burnoutRiskEl    = document.getElementById("burnoutRisk");
const warningBox       = document.getElementById("warningBox");
const warningText      = document.getElementById("warningText");
const pressureChartMsg = document.getElementById("pressureChartMessage");
const calendarMessage  = document.getElementById("calendarMessage");

/* ── Module state ── */
let _tasks       = [];
let _canEdit     = false;
let _sectionsMap = {};
let _peakLoads   = {};
let chartInstance = null;
let calInstance   = null;
let _calDate      = null;

/* ── Toast ── */
function showToast(message){
  const toast = document.getElementById("toast");
  if(!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function setWarning(message, level){
  warningBox.className = "warning-box";
  if(level === "high") warningBox.classList.add("warning-high");
  if(level === "low")  warningBox.classList.add("warning-low");
  if(warningText) warningText.textContent = message;
}

/* ── Load ── */
async function loadDashboard(user, role){
  try{
    const normalizedRole = (role || "").toLowerCase();
    const isStudent = normalizedRole === "student";
    const isTeacher = ["teacher", "faculty"].includes(normalizedRole);
    _canEdit = isTeacher || normalizedRole === "admin";

    const userSection = localStorage.getItem("userSection") || "";
    let userSections = [];
    try{
      const stored = JSON.parse(localStorage.getItem("userSections") || "[]");
      userSections = Array.isArray(stored) ? stored : [];
    } catch { userSections = []; }

    const [taskSnap, sectionSnap] = await Promise.all([
      getDocs(collection(db, "tasks")),
      getDocs(collection(db, "sections"))
    ]);

    _sectionsMap = {};
    sectionSnap.forEach((d) => { _sectionsMap[d.id] = d.data().name || d.id; });

    _tasks = taskSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => {
        const secs = getTaskSections(t);
        if(isStudent) return userSection ? secs.includes(userSection) : false;
        if(isTeacher) return secs.some((s) => userSections.includes(s));
        return true; // admin sees all
      });

    refresh();
  }
  catch(error){
    console.error("Unable to load dashboard", error);
    setWarning("Dashboard data could not be loaded. Check your Firebase connection.", "high");
  }
}

/* ── Re-render everything from current _tasks ── */
function refresh(){
  _peakLoads = peakDailyLoads(_tasks);

  const days   = nextDays(14);
  const series = days.map((d) => _peakLoads[d] || 0);
  const peakVal = series.length ? Math.max(...series) : 0;
  const pressureTier = classifyPressure(peakVal);
  const congestedCount = series.filter((v) => classifyPressure(v).level >= CONGESTION_LEVEL).length;

  const dueThisWeek = _tasks.filter((t) => {
    const d = daysFromToday(t.deadline);
    return d >= 0 && d <= 7;
  }).length;

  if(totalTasksEl) totalTasksEl.textContent = _tasks.length;
  if(deadlinesEl)  deadlinesEl.textContent  = dueThisWeek;

  // Pressure = busiest single day over the next 14 days
  if(pressureLevelEl){
    pressureLevelEl.textContent = pressureTier.label;
    pressureLevelEl.className   = "pressure-text " + pressureTier.id;
  }

  // Burnout = how many of the next 14 days are High+
  let burnout = "Low", burnoutCls = "risk-low";
  if(congestedCount >= 3){ burnout = "High";     burnoutCls = "risk-high"; }
  else if(congestedCount >= 1){ burnout = "Moderate"; burnoutCls = "risk-moderate"; }
  if(burnoutRiskEl){
    burnoutRiskEl.textContent = burnout;
    burnoutRiskEl.className   = "risk-text " + burnoutCls;
  }

  // Warning message keyed to the peak tier
  const peakDayIdx = series.indexOf(peakVal);
  const peakDayStr = peakDayIdx >= 0 ? shortDate(days[peakDayIdx]) : "";
  if(pressureTier.level >= CONGESTION_LEVEL)
    setWarning(`Heavy load ahead — ${peakDayStr} reaches ${pressureTier.label} (${peakVal} pts). Spread work out or use the balancer below.`, "high");
  else if(pressureTier.level === 1)
    setWarning(`Moderate workload — your busiest day (${peakDayStr}) sits at ${peakVal} pts. Keep pacing steady.`, "");
  else
    setWarning("Light schedule ahead. A good window to get ahead on coursework.", "low");

  renderForecastChart(days, series);
  renderCalendar();
  renderBalancer();
}

/* ── 14-day forecast bar chart (colored by daily pressure tier) ── */
function renderForecastChart(days, series){
  const ctx = document.getElementById("pressureChart");
  if(!ctx) return;

  if(_tasks.length === 0){
    ctx.classList.add("is-hidden");
    pressureChartMsg?.classList.remove("is-hidden");
    return;
  }
  if(!window.Chart){
    if(pressureChartMsg){ pressureChartMsg.textContent = "Chart library unavailable."; pressureChartMsg.classList.remove("is-hidden"); }
    return;
  }

  ctx.classList.remove("is-hidden");
  pressureChartMsg?.classList.add("is-hidden");

  const labels = days.map((d) => shortDate(d));
  const colors = series.map((v) => classifyPressure(v).color);

  if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Daily workload",
        data: series,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 0,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.parsed.y} pts · ${classifyPressure(c.parsed.y).label}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 10 }, maxRotation: 0, autoSkip: false } },
        y: { beginAtZero: true, ticks: { precision: 0, color: "#64748b" }, grid: { color: "rgba(100,116,139,0.1)" } }
      }
    }
  });

  // Tier legend
  const legendEl = document.getElementById("chartLegend");
  if(legendEl){
    legendEl.innerHTML = PRESSURE_TIERS.map((t) => {
      const range = t.max === Infinity ? `${t.min}+` : `${t.min}–${t.max}`;
      return `<span class="chart-legend-item">
        <span class="chart-legend-dot" style="background:${t.color}"></span>
        ${t.label} <small style="color:var(--muted)">(${range})</small>
      </span>`;
    }).join("");
  }
}

/* ── Calendar with workload heatmap + (teacher) drag-to-rebalance ── */
function renderCalendar(){
  const calendarEl = document.getElementById("calendar");
  if(!calendarEl) return;

  if(_tasks.length === 0){ calendarMessage?.classList.remove("is-hidden"); return; }
  if(!window.FullCalendar){
    if(calendarMessage){ calendarMessage.textContent = "Calendar library unavailable."; calendarMessage.classList.remove("is-hidden"); }
    return;
  }
  calendarMessage?.classList.add("is-hidden");

  const events = _tasks.map((task) => {
    const meta = typeMeta(task);
    const hasTime = Boolean(task.deadlineTime);
    return {
      id: task.id,
      title: task.title || "Untitled",
      start: hasTime ? `${task.deadline}T${task.deadlineTime}:00` : task.deadline,
      allDay: !hasTime,
      backgroundColor: meta.color,
      borderColor: meta.border,
      extendedProps: {
        effort: getEffort(task),
        subject: task.subject,
        type: meta.label,
        sections: getTaskSections(task).map((id) => _sectionsMap[id] || id)
      }
    };
  });

  const isMobile = window.innerWidth <= 600;
  if(calInstance) calInstance.destroy();

  calInstance = new FullCalendar.Calendar(calendarEl, {
    initialView: isMobile ? "listWeek" : "dayGridMonth",
    initialDate: _calDate || undefined,
    height: "auto",
    events,
    editable: _canEdit,
    eventStartEditable: _canEdit,
    headerToolbar: { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,listWeek" },
    slotMinTime: "06:00:00",
    slotMaxTime: "22:00:00",
    eventTimeFormat: { hour: "numeric", minute: "2-digit", meridiem: "short" },
    datesSet: (info) => { _calDate = info.view.currentStart; },
    dayCellDidMount: (arg) => {
      const load = _peakLoads[formatYMD(arg.date)] || 0;
      if(load <= 0) return;
      const tier = classifyPressure(load);
      arg.el.style.backgroundColor = tier.soft;
      arg.el.title = `Workload ${load} pts · ${tier.label}`;
      const top = arg.el.querySelector(".fc-daygrid-day-top");
      if(top){
        const dot = document.createElement("span");
        dot.className = "fc-load-dot";
        dot.style.background = tier.color;
        dot.textContent = load;
        top.prepend(dot);
      }
    },
    eventClick({ event }){
      const p = event.extendedProps;
      const sectionName = p.sections && p.sections.length ? p.sections.join(", ") : "Unassigned";
      const timeStr = event.allDay ? "All day" : (event.startStr.split("T")[1]?.slice(0, 5) || "—");
      alert(`${event.title}\n\nType: ${p.type}\nSubject: ${p.subject || "—"}\nSection(s): ${sectionName}\nDate: ${event.startStr.split("T")[0]}\nTime: ${timeStr}\nIntensity: ${p.effort} / 5`);
    },
    eventDrop: async (info) => {
      if(!_canEdit){ info.revert(); return; }
      const id = info.event.id;
      const newDate = formatYMD(info.event.start);
      try{
        await persistMove(id, newDate);
        const t = _tasks.find((x) => x.id === id);
        if(t) t.deadline = newDate;
        showToast(`Moved “${info.event.title}” to ${shortDate(newDate)}.`);
        refresh();
      }
      catch(e){
        console.error(e);
        info.revert();
        showToast("Could not move task.");
      }
    },
    dayMaxEvents: 3
  });

  calInstance.render();

  if(window.location.hash === "#calendar"){
    requestAnimationFrame(() => requestAnimationFrame(() => {
      calendarEl.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", window.location.pathname);
    }));
  }
}

/* ── Smart Load Balancing suggestions (teacher / admin) ── */
function renderBalancer(){
  const panel = document.getElementById("balancerPanel");
  const list  = document.getElementById("balancerList");
  const msg   = document.getElementById("balancerMessage");
  if(!panel || !list) return;

  if(!_canEdit){ panel.classList.add("is-hidden"); return; }
  panel.classList.remove("is-hidden");

  const recs = buildBalancerRecommendations(_tasks);

  if(recs.length === 0){
    msg.textContent = "No congestion detected — workloads look balanced across the next two weeks.";
    msg.classList.remove("is-hidden");
    list.innerHTML = "";
    return;
  }

  msg.classList.add("is-hidden");
  list.innerHTML = "";
  recs.forEach((r) => {
    const sectionName = r.sectionId ? (_sectionsMap[r.sectionId] || r.sectionId) : "Unassigned";
    const item = document.createElement("div");
    item.className = "balancer-item";
    item.innerHTML = `
      <div class="balancer-item-main">
        <span class="balancer-move">
          <strong>${r.title}</strong>
          <span class="balancer-arrow">${shortDate(r.from)} &rarr; ${shortDate(r.to)}</span>
        </span>
        <span class="balancer-reason">${sectionName} · ${r.reason}</span>
      </div>
      <button type="button" class="primary-button balancer-apply" data-id="${r.taskId}" data-to="${r.to}" data-title="${r.title}">
        Apply
      </button>`;
    list.append(item);
  });
}

async function persistMove(taskId, newDate){
  await updateDoc(doc(db, "tasks", taskId), { deadline: newDate });
}

/* ── Balancer Apply (event delegation, bound once) ── */
document.getElementById("balancerList")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".balancer-apply");
  if(!btn) return;

  const { id, to, title } = btn.dataset;
  showConfirmModal({
    title: "Apply suggestion?",
    body: `Move “${title}” to ${shortDate(to)}? Students in the section will see the new deadline.`,
    confirmLabel: "Apply move",
    loadingLabel: "Applying…",
    onConfirm: async () => {
      try{
        await persistMove(id, to);
        const t = _tasks.find((x) => x.id === id);
        if(t) t.deadline = to;
        showToast("Deadline updated.");
        refresh();
      }
      catch(err){
        console.error(err);
        showToast("Could not apply suggestion.");
      }
    }
  });
});

/* Smooth-scroll to calendar from the sidebar link */
document.querySelector('.sidebar a[href="dashboard.html#calendar"]')
  ?.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("calendar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

initNav((user, role) => loadDashboard(user, role));
