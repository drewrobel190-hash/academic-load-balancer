import { db } from "./firebase-config.js";
import { initNav } from "./nav.js";

import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getEffort, typeMeta, getTaskSections } from "./workload.js";
import { enhanceMultiSelect, syncMultiSelectsIn } from "./multiselect.js";

const ROLES = ["student", "teacher", "faculty", "admin"];

let allUsers    = [];
let allTasks    = [];
let allSections = [];  // [{ id, name }]

function showToast(message){
  const toast = document.getElementById("toast");
  if(!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

/* ════════════════════════════════════════
   STATS
════════════════════════════════════════ */
function renderStats(){
  const el = document.getElementById("adminStats");
  if(!el) return;

  const totalUsers    = allUsers.length;
  const totalTasks    = allTasks.length;
  const today         = new Date(); today.setHours(0,0,0,0);
  const overdueTasks  = allTasks.filter((t) => {
    if(!t.deadline) return false;
    return new Date(`${t.deadline}T00:00:00`) < today;
  }).length;
  const highLoadTasks = allTasks.filter((t) => getEffort(t) >= 4).length;

  el.innerHTML = `
    <div class="stat-chip">
      <span class="stat-chip-label">Total Users</span>
      <span class="stat-chip-value">${totalUsers}</span>
      <span class="stat-chip-sub">registered accounts</span>
    </div>
    <div class="stat-chip">
      <span class="stat-chip-label">Total Tasks</span>
      <span class="stat-chip-value">${totalTasks}</span>
      <span class="stat-chip-sub">across all sections</span>
    </div>
    <div class="stat-chip">
      <span class="stat-chip-label">Overdue</span>
      <span class="stat-chip-value" style="color:var(--danger)">${overdueTasks}</span>
      <span class="stat-chip-sub">past deadline</span>
    </div>
    <div class="stat-chip">
      <span class="stat-chip-label">High-Load Tasks</span>
      <span class="stat-chip-value" style="color:var(--amber)">${highLoadTasks}</span>
      <span class="stat-chip-sub">projects &amp; exams</span>
    </div>
  `;
}

/* ════════════════════════════════════════
   AT-RISK ALERTS
════════════════════════════════════════ */
function renderAtRisk(){
  const section   = document.getElementById("atRiskSection");
  const countEl   = document.getElementById("atRiskCount");
  const messageEl = document.getElementById("atRiskMessage");
  const listEl    = document.getElementById("atRiskList");
  if(!section || !listEl) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const in14  = new Date(today); in14.setDate(today.getDate() + 14);

  const upcoming = allTasks.filter((t) => {
    if(!t.deadline) return false;
    const due = new Date(`${t.deadline}T00:00:00`);
    return due >= today && due <= in14 && getEffort(t) >= 4;
  });

  section.classList.remove("is-hidden");

  if(upcoming.length === 0){
    messageEl.classList.remove("is-hidden");
    listEl.innerHTML = "";
    if(countEl) countEl.textContent = "0";
    return;
  }

  messageEl.classList.add("is-hidden");
  if(countEl) countEl.textContent = String(upcoming.length);

  upcoming.sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));

  const sectionMap = Object.fromEntries(allSections.map((s) => [s.id, s.name]));

  listEl.innerHTML = upcoming.map((t) => {
    const score    = getEffort(t);
    const meta     = typeMeta(t);
    const color    = meta.color;
    const type     = meta.label;
    const secNames     = getTaskSections(t).map((id) => sectionMap[id] || id);
    const sectionLabel = secNames.length ? secNames.join(", ") : "Unassigned";
    const due = new Date(`${t.deadline}T00:00:00`)
      .toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });

    return `<li class="admin-alert-item">
      <span class="admin-alert-dot" style="background:${color}"></span>
      <span class="admin-alert-body">
        <strong>${t.title || "Untitled"}</strong>
        <span>${t.subject || "—"} · ${type} · ${sectionLabel} · Due ${due}</span>
      </span>
      <span class="admin-alert-score" style="color:${color}">${score}/5</span>
    </li>`;
  }).join("");
}

/* ════════════════════════════════════════
   SECTIONS
════════════════════════════════════════ */
function getTeacherSectionIds(userData){
  const ids  = Array.isArray(userData?.sectionIds) ? userData.sectionIds : [];
  const role = (userData?.role || "").toLowerCase();

  // Backward compatibility for teachers that previously had one sectionId.
  if(ids.length === 0 && ["teacher", "faculty"].includes(role) && userData?.sectionId){
    return [userData.sectionId];
  }

  return [...new Set(ids.filter((id) => typeof id === "string" && id))];
}

function renderSectionList(){
  const listEl   = document.getElementById("sectionList");
  const countEl  = document.getElementById("sectionCount");
  if(!listEl) return;

  if(countEl) countEl.textContent = String(allSections.length);

  if(allSections.length === 0){
    listEl.innerHTML = `<p class="chart-message">No sections yet. Add one above.</p>`;
    return;
  }

  listEl.innerHTML = allSections
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const studentCount = allUsers.filter((u) =>
        (u.role || "student").toLowerCase() === "student" && u.sectionId === s.id
      ).length;
      const teacherCount = allUsers.filter((u) => {
        const role = (u.role || "").toLowerCase();
        return ["teacher", "faculty"].includes(role) && getTeacherSectionIds(u).includes(s.id);
      }).length;
      return `<div class="admin-section-item" data-section-id="${s.id}">
        <div class="admin-section-info">
          <span class="admin-section-name">${s.name}</span>
          <span class="admin-section-meta">${studentCount} student${studentCount !== 1 ? "s" : ""} · ${teacherCount} teacher${teacherCount !== 1 ? "s" : ""}</span>
        </div>
        <button type="button" class="danger-button admin-section-delete" data-section-id="${s.id}" data-section-name="${s.name}"
          style="font-size:0.78rem;min-height:32px;padding:5px 12px">
          Delete
        </button>
      </div>`;
    }).join("");
}

document.getElementById("createSectionForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("sectionNameInput");
  const name  = input?.value.trim();
  if(!name) return;

  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled    = true;
  btn.textContent = "Adding…";

  try{
    const ref = await addDoc(collection(db, "sections"), {
      name,
      createdAt: new Date().toISOString()
    });
    allSections.push({ id: ref.id, name });
    if(input) input.value = "";
    renderSectionList();
    renderUserTable(document.getElementById("userSearch")?.value || "");
    showToast(`Section "${name}" created.`);
  }
  catch(err){
    console.error("Create section error", err);
    showToast("Failed to create section.");
  }
  finally{
    btn.disabled    = false;
    btn.textContent = "+ Add Section";
  }
});

document.getElementById("sectionList")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".admin-section-delete");
  if(!btn) return;

  const sectionId   = btn.dataset.sectionId;
  const sectionName = btn.dataset.sectionName;

  if(!window.confirm(`Delete section "${sectionName}"? Students and teachers assigned to it will be updated.`)) return;

  btn.disabled    = true;
  btn.textContent = "Deleting…";

  try{
    await deleteDoc(doc(db, "sections", sectionId));

    // Remove the deleted section from students and teacher assignments.
    const affected = allUsers.filter((u) =>
      u.sectionId === sectionId || getTeacherSectionIds(u).includes(sectionId)
    );
    await Promise.all(
      affected.map((u) => {
        const role = (u.role || "student").toLowerCase();
        if(role === "student"){
          return updateDoc(doc(db, "users", u.email), { sectionId: "" });
        }
        return updateDoc(doc(db, "users", u.email), {
          sectionId: "",
          sectionIds: getTeacherSectionIds(u).filter((id) => id !== sectionId)
        });
      })
    );
    affected.forEach((u) => {
      if(u.sectionId === sectionId) u.sectionId = "";
      u.sectionIds = getTeacherSectionIds(u).filter((id) => id !== sectionId);
    });

    allSections = allSections.filter((s) => s.id !== sectionId);
    renderSectionList();
    renderUserTable(document.getElementById("userSearch")?.value || "");
    showToast(`Section "${sectionName}" deleted.`);
  }
  catch(err){
    console.error("Delete section error", err);
    showToast("Failed to delete section.");
    btn.disabled    = false;
    btn.textContent = "Delete";
  }
});

/* ════════════════════════════════════════
   USER TABLE
════════════════════════════════════════ */
function buildUserRow(userData){
  const { email, role, sectionId } = userData;
  const initial    = email.charAt(0).toUpperCase();
  const badgeClass = { student:"badge-student", teacher:"badge-faculty", faculty:"badge-faculty", admin:"badge-admin" }[role] || "badge-student";
  const normalizedRole = (role || "student").toLowerCase();
  const isStudent  = normalizedRole === "student";
  const isTeacher  = ["teacher", "faculty"].includes(normalizedRole);
  const teacherSectionIds = getTeacherSectionIds(userData);

  const roleOptions = ROLES.map((r) =>
    `<option value="${r}" ${r === role ? "selected" : ""}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`
  ).join("");

  const sectionOptions = `<option value="">— No section —</option>` +
    allSections
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `<option value="${s.id}" ${s.id === sectionId ? "selected" : ""}>${s.name}</option>`)
      .join("");

  const teacherSectionOptions = allSections.length
    ? allSections
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `
        <label class="admin-section-choice">
          <input
            type="checkbox"
            class="admin-teacher-section-checkbox"
            value="${s.id}"
            ${teacherSectionIds.includes(s.id) ? "checked" : ""}
          >
          <span>${s.name}</span>
        </label>`)
      .join("")
    : `<span class="admin-section-empty">Create a section first.</span>`;

  const tr = document.createElement("tr");
  tr.dataset.email = email;

  tr.innerHTML = `
    <td class="admin-user-cell">
      <span class="admin-user-avatar">${initial}</span>
      <span class="admin-user-email">${email}</span>
    </td>
    <td><span class="profile-role-badge ${badgeClass}">${role || "student"}</span></td>
    <td>
      <select class="admin-role-select" data-email="${email}">
        ${roleOptions}
      </select>
    </td>
    <td>
      <div class="admin-section-control">
        <select class="admin-section-select admin-student-section ${!isStudent ? "is-hidden" : ""}">
          ${sectionOptions}
        </select>
        <div class="admin-teacher-sections ${!isTeacher ? "is-hidden" : ""}">
          <span class="admin-section-help">Select one or more</span>
          <div class="admin-section-checklist">
            ${teacherSectionOptions}
          </div>
        </div>
        <span class="admin-section-not-applicable ${normalizedRole !== "admin" ? "is-hidden" : ""}">
          Not assigned
        </span>
      </div>
    </td>
    <td class="admin-actions-cell">
      <button type="button" class="primary-button admin-save-btn"
        style="font-size:0.78rem;min-height:34px;padding:6px 12px" data-email="${email}">
        Save
      </button>
    </td>
  `;
  return tr;
}

function renderUserTable(filter = ""){
  const tbody     = document.getElementById("userTableBody");
  const table     = document.getElementById("userTable");
  const messageEl = document.getElementById("userTableMessage");
  if(!tbody || !table) return;

  const filtered = filter
    ? allUsers.filter((u) => u.email.toLowerCase().includes(filter.toLowerCase()))
    : allUsers;

  if(filtered.length === 0){
    table.classList.add("is-hidden");
    if(messageEl){ messageEl.textContent = filter ? "No users match your search." : "No users found."; messageEl.classList.remove("is-hidden"); }
    return;
  }

  table.classList.remove("is-hidden");
  if(messageEl) messageEl.classList.add("is-hidden");

  tbody.innerHTML = "";
  filtered.forEach((u) => tbody.append(buildUserRow(u)));

  // Enhance each teacher's section checklist into a multi-select dropdown (UI only).
  tbody.querySelectorAll(".admin-teacher-sections .admin-section-checklist").forEach((el) => {
    enhanceMultiSelect(el, { placeholder: "Assign section(s)…" });
  });
}

async function saveUserChanges(email, newRole, newSectionId, newSectionIds = []){
  try{
    const updates = { role: newRole, sectionId:"", sectionIds:[] };

    if(newRole === "student"){
      updates.sectionId = newSectionId;
    }
    else if(["teacher", "faculty"].includes(newRole)){
      updates.sectionIds = [...new Set(newSectionIds.filter(Boolean))];
    }

    await updateDoc(doc(db, "users", email), updates);

    const user = allUsers.find((u) => u.email === email);
    if(user){
      user.role       = newRole;
      user.sectionId  = updates.sectionId;
      user.sectionIds = updates.sectionIds;
    }

    const assignedIds = newRole === "student"
      ? [updates.sectionId].filter(Boolean)
      : updates.sectionIds;
    const assignedNames = assignedIds
      .map((id) => allSections.find((s) => s.id === id)?.name)
      .filter(Boolean);
    showToast(`Saved ${newRole}: ${assignedNames.length ? assignedNames.join(", ") : "no section assigned"}`);
    renderUserTable(document.getElementById("userSearch")?.value || "");
    renderSectionList();
  }
  catch(err){
    console.error("Save user error", err);
    showToast("Failed to save changes. Check Firestore rules.");
  }
}

document.getElementById("userTableBody")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".admin-save-btn");
  if(!btn) return;

  const row           = btn.closest("tr");
  const email         = btn.dataset.email;
  const roleSelect    = row?.querySelector(".admin-role-select");
  const sectionSel    = row?.querySelector(".admin-student-section");
  const sectionChecks = [...(row?.querySelectorAll(".admin-teacher-section-checkbox:checked") || [])];
  if(!roleSelect || !email) return;

  btn.disabled    = true;
  btn.textContent = "Saving…";

  await saveUserChanges(
    email,
    roleSelect.value,
    sectionSel?.value || "",
    sectionChecks.map((checkbox) => checkbox.value)
  );

  btn.disabled    = false;
  btn.textContent = "Save";
});

// Switch between one student section and multiple teacher sections.
document.getElementById("userTableBody")?.addEventListener("change", (e) => {
  const roleSelect = e.target.closest(".admin-role-select");
  if(!roleSelect) return;

  const row            = roleSelect.closest("tr");
  const studentSelect  = row?.querySelector(".admin-student-section");
  const teacherControl = row?.querySelector(".admin-teacher-sections");
  const notApplicable  = row?.querySelector(".admin-section-not-applicable");
  const teacherChecks  = [...(row?.querySelectorAll(".admin-teacher-section-checkbox") || [])];
  const newRole        = roleSelect.value;
  const isStudent      = newRole === "student";
  const isTeacher      = ["teacher", "faculty"].includes(newRole);

  if(isTeacher && studentSelect?.value && !teacherChecks.some((checkbox) => checkbox.checked)){
    const matchingCheckbox = teacherChecks.find((checkbox) => checkbox.value === studentSelect.value);
    if(matchingCheckbox) matchingCheckbox.checked = true;
  }

  if(isStudent){
    const selectedTeacherSections = teacherChecks.filter((checkbox) => checkbox.checked);
    if(selectedTeacherSections.length === 1 && studentSelect){
      studentSelect.value = selectedTeacherSections[0].value;
    }
  }

  studentSelect?.classList.toggle("is-hidden", !isStudent);
  teacherControl?.classList.toggle("is-hidden", !isTeacher);
  notApplicable?.classList.toggle("is-hidden", newRole !== "admin");

  syncMultiSelectsIn(row);   // refresh chips after the role switch toggled checkboxes
});

document.getElementById("userSearch")?.addEventListener("input", (e) => {
  renderUserTable(e.target.value);
});

/* ════════════════════════════════════════
   LOAD
════════════════════════════════════════ */
async function loadAdminData(){
  try{
    const [userSnap, taskSnap, sectionSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "tasks")),
      getDocs(collection(db, "sections"))
    ]);

    allUsers    = userSnap.docs.map((d) => ({ email: d.id, ...d.data() }));
    allTasks    = taskSnap.docs.map((d) => d.data());
    allSections = sectionSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Add Section column header to user table
    const thead = document.querySelector("#userTable thead tr");
    if(thead && !thead.querySelector("th.section-col")){
      const th = document.createElement("th");
      th.className   = "section-col";
      th.textContent = "Assigned Sections";
      // Insert before last th (Action)
      thead.insertBefore(th, thead.lastElementChild);
    }

    renderStats();
    renderAtRisk();
    renderSectionList();
    renderUserTable();
  }
  catch(err){
    console.error("Admin load error", err);
    const msg = document.getElementById("userTableMessage");
    if(msg){ msg.textContent = "Failed to load data. Check Firestore rules."; msg.classList.remove("is-hidden"); }
  }
}

initNav((user, role) => {
  if(role.toLowerCase() !== "admin"){
    window.location.href = "dashboard.html";
    return;
  }
  loadAdminData();
});
