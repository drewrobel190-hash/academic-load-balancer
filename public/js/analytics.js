import { db } from "./firebase-config.js";
import { initNav } from "./nav.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  TASK_TYPES,
  getEffort,
  getTaskType,
  getTaskSections
} from "./workload.js";

const TYPE_BY_VALUE = Object.fromEntries(TASK_TYPES.map((t) => [t.value, t]));

function showToast(message){
  const toast = document.getElementById("toast");
  if(!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function renderStats(tasks, subjects){
  const el = document.getElementById("analyticsStats");
  if(!el) return;

  const total      = tasks.length;
  const totalScore = tasks.reduce((s, t) => s + getEffort(t), 0);
  const avg        = total ? (totalScore / total).toFixed(1) : "0";
  const peakEntry  = Object.entries(subjects).sort(([, a], [, b]) => b - a)[0];
  const peakSubj   = peakEntry ? peakEntry[0] : "—";
  const highRisk   = tasks.filter((t) => getEffort(t) >= 4).length;

  el.innerHTML = `
    <div class="stat-chip">
      <span class="stat-chip-label">Total Tasks</span>
      <span class="stat-chip-value">${total}</span>
      <span class="stat-chip-sub">logged this period</span>
    </div>
    <div class="stat-chip">
      <span class="stat-chip-label">Avg Intensity</span>
      <span class="stat-chip-value">${avg}<small style="font-size:1rem;font-weight:700"> / 5</small></span>
      <span class="stat-chip-sub">per task</span>
    </div>
    <div class="stat-chip">
      <span class="stat-chip-label">Peak Subject</span>
      <span class="stat-chip-value" style="font-size:1.1rem;letter-spacing:-0.01em">${peakSubj}</span>
      <span class="stat-chip-sub">highest workload</span>
    </div>
    <div class="stat-chip">
      <span class="stat-chip-label">High-Load Tasks</span>
      <span class="stat-chip-value">${highRisk}</span>
      <span class="stat-chip-sub">projects &amp; exams</span>
    </div>
  `;
}

async function loadAnalytics(role){
  try{
    const snap = await getDocs(collection(db, "tasks"));
    const normalizedRole = (role || "").toLowerCase();
    const isStudent = normalizedRole === "student";
    const isTeacher = ["teacher", "faculty"].includes(normalizedRole);
    const userSection = localStorage.getItem("userSection") || "";
    let userSections = [];
    try{
      const stored = JSON.parse(localStorage.getItem("userSections") || "[]");
      userSections = Array.isArray(stored) ? stored : [];
    } catch { userSections = []; }

    const tasks = snap.docs
      .map((d) => d.data())
      .filter((task) => {
        const secs = getTaskSections(task);
        if(isStudent) return userSection ? secs.includes(userSection) : false;
        if(isTeacher) return secs.some((s) => userSections.includes(s));
        return true;
      });

    const subjects   = {};
    const typeCounts = {};
    TASK_TYPES.forEach((t) => { typeCounts[t.value] = 0; });

    tasks.forEach((task) => {
      const subj = task.subject || "Unassigned";
      subjects[subj] = (subjects[subj] || 0) + getEffort(task);
      const type = getTaskType(task);
      if(typeCounts[type] !== undefined) typeCounts[type]++;
    });

    renderStats(tasks, subjects);
    createSubjectChart(subjects);
    createPieChart(typeCounts);
  }
  catch(error){
    console.error("Unable to load analytics", error);
  }
}

function createSubjectChart(subjects){
  const ctx     = document.getElementById("subjectChart");
  const message = document.getElementById("subjectChartMessage");
  const labels  = Object.keys(subjects);
  const values  = Object.values(subjects);

  if(!ctx) return;
  if(labels.length === 0){
    ctx.classList.add("is-hidden");
    message?.classList.remove("is-hidden");
    return;
  }
  if(!window.Chart){
    if(message){ message.textContent = "Chart library unavailable."; message.classList.remove("is-hidden"); }
    return;
  }

  ctx.classList.remove("is-hidden");
  message?.classList.add("is-hidden");

  const maxVal    = Math.max(...values);
  const barColors = values.map((v) => {
    const ratio = v / maxVal;
    if(ratio >= 0.75) return "#ef4444";
    if(ratio >= 0.5)  return "#f59e0b";
    if(ratio >= 0.25) return "#14b8a6";
    return "#3b82f6";
  });

  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Total Workload",
        data: values,
        backgroundColor: barColors,
        borderColor: barColors,
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` Workload: ${c.parsed.y} pts` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1, color: "#64748b" }, grid: { color: "rgba(100,116,139,0.1)" } }
      }
    }
  });
}

function createPieChart(typeCounts){
  const ctx     = document.getElementById("workloadPieChart");
  const message = document.getElementById("workloadPieChartMessage");
  const total   = Object.values(typeCounts).reduce((s, v) => s + v, 0);

  if(!ctx) return;
  if(total === 0){
    ctx.classList.add("is-hidden");
    message?.classList.remove("is-hidden");
    return;
  }
  if(!window.Chart){
    if(message){ message.textContent = "Chart library unavailable."; message.classList.remove("is-hidden"); }
    return;
  }

  ctx.classList.remove("is-hidden");
  message?.classList.add("is-hidden");

  const active     = Object.entries(typeCounts).filter(([, v]) => v > 0);
  const pieLabels  = active.map(([k]) => TYPE_BY_VALUE[k]?.label || k);
  const pieData    = active.map(([, v]) => v);
  const pieColors  = active.map(([k]) => TYPE_BY_VALUE[k]?.color || "#94a3b8");

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: pieLabels,
      datasets: [{
        data: pieData,
        backgroundColor: pieColors,
        borderColor: "transparent",
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#64748b", font: { weight: "700", size: 12 }, padding: 16, usePointStyle: true, pointStyle: "rect" }
        },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} task${c.parsed !== 1 ? "s" : ""}` } }
      }
    }
  });
}

function exportPDF(){
  if(!window.jspdf){
    showToast("PDF export unavailable. Check your connection.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const report = new jsPDF();
  const date   = new Date().toLocaleDateString();

  report.setFontSize(20);
  report.setFont(undefined, "bold");
  report.text("Academic Load Analytics Report", 20, 22);

  report.setFontSize(11);
  report.setFont(undefined, "normal");
  report.setTextColor(100, 116, 139);
  report.text(`Generated: ${date}`, 20, 32);
  report.text("Academic Workload Monitoring and Load Balancing System", 20, 40);

  report.save("ALB_Analytics_Report.pdf");
}

document.getElementById("exportBtn")?.addEventListener("click", exportPDF);

initNav((user, role) => loadAnalytics(role));
