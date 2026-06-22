import { db } from "./firebase-config.js";
import { initNav } from "./nav.js";

import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc as firestoreDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  TASK_TYPES,
  typeMeta,
  getEffort,
  getTaskType,
  isMovable,
  getTaskSections
} from "./workload.js";

import { enhanceMultiSelect } from "./multiselect.js";

/* ── DOM refs ── */
const taskForm          = document.getElementById("taskForm");
const saveTaskBtn       = document.getElementById("saveTaskBtn");
const cancelEditBtn     = document.getElementById("cancelEditBtn");
const taskList          = document.getElementById("taskList");
const titleInput        = document.getElementById("title");
const subjectInput      = document.getElementById("subject");
const taskTypeInput     = document.getElementById("taskType");
const effortInput       = document.getElementById("effortScore");
const movableInput      = document.getElementById("movableInput");
const deadlineInput     = document.getElementById("deadline");
const deadlineTimeInput = document.getElementById("deadlineTime");
const sectionCheckList  = document.getElementById("sectionCheckList");
const filterSection     = document.getElementById("filterSection");
const searchInput       = document.getElementById("searchInput");
const filterWorkload    = document.getElementById("filterWorkload");
const taskFormTitle     = document.getElementById("taskFormTitle");
const sectionField      = document.getElementById("sectionField");
const deleteConfirmBackdrop = document.getElementById("deleteConfirmBackdrop");
const deleteTaskName        = document.getElementById("deleteTaskName");
const cancelDeleteBtn       = document.getElementById("cancelDeleteBtn");
const confirmDeleteBtn      = document.getElementById("confirmDeleteBtn");

/** Prefill effort + flexibility from the chosen task type. */
function applyTypeDefaults(){
  const meta = TASK_TYPES.find((t) => t.value === taskTypeInput.value) || TASK_TYPES[0];
  if(effortInput)  effortInput.value   = String(meta.defaultEffort);
  if(movableInput) movableInput.checked = meta.movable;
}

taskTypeInput?.addEventListener("change", applyTypeDefaults);

let editingTaskId  = null;
let _canEdit       = false;
let _userSection   = "";   // sectionId of the logged-in student (empty = teacher/admin)
let _userSections  = [];   // sectionIds assigned to a teacher/faculty member
let _isAdmin       = false;
let _sectionsMap   = {};   // { sectionId: sectionName }
let _editingOriginalSections = []; // sections of the task being edited (to preserve unseen ones)
let taskSectionMS  = null;         // the enhanced multi-select dropdown instance
let _currentUid    = "";           // logged-in user's uid  (task ownership)
let _currentEmail  = "";           // logged-in user's email
let _tasksById     = {};           // id -> task data, for ownership lookups in handlers
let pendingDeleteId = null;
let deleteTrigger   = null;

/**
 * Can the current user edit/delete THIS task?
 *   Admin    → every task.
 *   Teacher  → only tasks they created (legacy/unknown owner → no).
 *   Student  → never.
 */
function canModifyTask(task){
  if(!task) return false;
  if(_isAdmin) return true;
  if(!_canEdit) return false;
  if(task.createdBy && task.createdBy === _currentUid) return true;
  if(task.createdByEmail && task.createdByEmail === _currentEmail) return true;
  return false;
}

/* ── Toast ── */
function showToast(message){
  const toast = document.getElementById("toast");
  if(!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

/* Delete confirmation */
function openDeleteConfirmation(id, taskTitle, trigger){
  if(!deleteConfirmBackdrop) return;

  pendingDeleteId = id;
  deleteTrigger   = trigger;
  deleteTaskName.textContent = taskTitle || "this task";
  deleteConfirmBackdrop.classList.add("is-open");
  deleteConfirmBackdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => cancelDeleteBtn?.focus());
}

function closeDeleteConfirmation({ restoreFocus = true } = {}){
  if(!deleteConfirmBackdrop) return;

  deleteConfirmBackdrop.classList.remove("is-open");
  deleteConfirmBackdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  pendingDeleteId = null;

  if(restoreFocus) deleteTrigger?.focus();
  deleteTrigger = null;
}

/* ── Load sections from Firestore ── */
async function loadSectionsMap(){
  try{
    const snap = await getDocs(collection(db, "sections"));
    const map  = {};
    snap.forEach((d) => { map[d.id] = d.data().name || d.id; });
    return map;
  }
  catch(e){ console.warn("Could not load sections", e); return {}; }
}

/** Creation form: render an assignable section as a checkbox per section. */
function renderSectionCheckboxes(sectionsMap){
  if(!sectionCheckList) return;
  const entries = Object.entries(sectionsMap).sort((a, b) => a[1].localeCompare(b[1]));

  sectionCheckList.innerHTML = entries.length === 0
    ? `<span class="admin-section-empty">No sections available. Ask an admin to create or assign one.</span>`
    : entries.map(([id, name]) => `
        <label class="admin-section-choice">
          <input type="checkbox" class="task-section-checkbox" value="${id}">
          <span>${name}</span>
        </label>`).join("");

  // Enhance the checkbox list into a compact multi-select dropdown (presentation only).
  taskSectionMS = enhanceMultiSelect(sectionCheckList, { placeholder: "Select section(s)…" });
  taskSectionMS?.sync();
}

/** Filter bar: single-select of every section (a task matches any one of its sections). */
function populateFilterSection(sectionsMap){
  if(!filterSection) return;
  while(filterSection.options.length > 1) filterSection.remove(1);
  Object.entries(sectionsMap)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([id, name]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.text  = name;
      filterSection.append(opt);
    });
}

function getCheckedSectionIds(){
  return [...(sectionCheckList?.querySelectorAll(".task-section-checkbox:checked") || [])].map((c) => c.value);
}

function setCheckedSectionIds(ids){
  const set = new Set(ids || []);
  sectionCheckList?.querySelectorAll(".task-section-checkbox").forEach((c) => { c.checked = set.has(c.value); });
  taskSectionMS?.sync();   // refresh chips after programmatic change
}

/* ── Form helpers ── */
function getTaskFormData(){
  const effortScore = Number(effortInput?.value || 1);
  return {
    title:        titleInput.value.trim(),
    subject:      subjectInput.value.trim(),
    taskType:     taskTypeInput.value,
    effortScore,
    workloadScore: effortScore,            // kept in sync for backward compatibility
    movable:      Boolean(movableInput?.checked),
    deadline:     deadlineInput.value,
    deadlineTime: deadlineTimeInput?.value || "",
    sectionIds:   collectSectionIds(),     // multi-section assignment
    sectionId:    ""                       // clear legacy single field on every save
  };
}

/**
 * Checked sections + any already-assigned sections that aren't in this user's
 * checklist (e.g. a teacher editing a task that also belongs to a section they
 * don't own) — so saving never silently drops an assignment they can't see.
 */
function collectSectionIds(){
  const checked    = getCheckedSectionIds();
  const renderedIds = new Set(
    [...(sectionCheckList?.querySelectorAll(".task-section-checkbox") || [])].map((c) => c.value)
  );
  const preserved  = (editingTaskId ? _editingOriginalSections : []).filter((id) => !renderedIds.has(id));
  return [...new Set([...checked, ...preserved])];
}

function resetTaskForm(){
  editingTaskId = null;
  _editingOriginalSections = [];
  taskForm.reset();
  if(deadlineTimeInput) deadlineTimeInput.value = "";
  setCheckedSectionIds([]);
  applyTypeDefaults();
  saveTaskBtn.textContent   = "Save Task";
  taskFormTitle.textContent = "Add Academic Task";
  cancelEditBtn.classList.add("is-hidden");
}

/* ── Date helpers ── */
function getDateCategory(deadline){
  if(!deadline) return "none";
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const due      = new Date(`${deadline}T00:00:00`);
  const diffDays = Math.round((due - today) / 86400000);

  if(diffDays < 0)   return "overdue";
  if(diffDays === 0) return "today";
  if(diffDays === 1) return "tomorrow";
  if(diffDays <= 7)  return "week";
  return "later";
}

function formatDeadline(deadline, deadlineTime){
  if(!deadline) return "Not set";
  const d = new Date(`${deadline}T00:00:00`);
  let result = d.toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
  if(deadlineTime){
    const [h, m] = deadlineTime.split(":");
    const t = new Date(); t.setHours(Number(h), Number(m));
    result += " · " + t.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
  }
  return result;
}

function isDueSoon(deadline){
  if(!deadline) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(`${deadline}T00:00:00`);
  const in7   = new Date(today); in7.setDate(today.getDate() + 7);
  return due >= today && due <= in7;
}

/* ── Grouping ── */
const GROUP_CONFIG = [
  { id:"overdue",  label:"Overdue",       cls:"group-overdue"   },
  { id:"today",    label:"Due Today",     cls:"group-today"     },
  { id:"tomorrow", label:"Due Tomorrow",  cls:"group-tomorrow"  },
  { id:"week",     label:"This Week",     cls:"group-week"      },
  { id:"later",    label:"Coming Up",     cls:"group-later"     },
  { id:"none",     label:"No Deadline",   cls:"group-none"      },
];

function buildGroups(docs){
  const map = { overdue:[], today:[], tomorrow:[], week:[], later:[], none:[] };
  docs.forEach((d) => {
    const cat = getDateCategory(d.data().deadline);
    map[cat].push(d);
  });

  const sortByScore = (arr) => [...arr].sort((a, b) => {
    const diff = getEffort(b.data()) - getEffort(a.data());
    return diff !== 0 ? diff : (a.data().title || "").localeCompare(b.data().title || "");
  });

  return GROUP_CONFIG
    .map((cfg) => ({ ...cfg, docs: sortByScore(map[cfg.id]) }))
    .filter((g) => g.docs.length > 0);
}

/* ── Task item ── */
function createMetaItem(label, value){
  const item   = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = label;
  item.append(strong, value || "Not set");
  return item;
}

function createTaskItem(taskDoc){
  const task          = taskDoc.data();
  const meta          = typeMeta(task);
  const effort        = getEffort(task);
  const workloadLabel = meta.label;
  const fillPct       = Math.round((effort / 5) * 100);
  const dueSoon       = isDueSoon(task.deadline);
  const flexible      = isMovable(task);
  const sectionNames  = getTaskSections(task).map((id) => _sectionsMap[id] || id);

  const article = document.createElement("article");
  article.className    = "task-item";
  article.dataset.type = getTaskType(task);

  // header
  const header = document.createElement("div");
  header.className = "task-item-header";
  const title  = document.createElement("h3");
  title.textContent = task.title || "Untitled task";
  const badgeWrap = document.createElement("div");
  badgeWrap.className = "task-badge-group";
  const badge  = document.createElement("span");
  badge.className   = "task-badge";
  badge.textContent = workloadLabel;
  badge.style.background = meta.color + "22";   // tinted from the type color
  badge.style.color      = meta.color;
  badgeWrap.append(badge);
  if(flexible){
    const flexBadge = document.createElement("span");
    flexBadge.className   = "task-flex-badge";
    flexBadge.textContent = "Flexible";
    flexBadge.title       = "The load balancer may suggest moving this task";
    badgeWrap.append(flexBadge);
  }
  if(sectionNames.length){
    sectionNames.forEach((name) => {
      const secBadge = document.createElement("span");
      secBadge.className   = "task-section-badge";
      secBadge.textContent = name;
      badgeWrap.append(secBadge);
    });
  }
  else{
    const unassigned = document.createElement("span");
    unassigned.className   = "task-section-badge task-section-badge--none";
    unassigned.textContent = "Unassigned";
    unassigned.title       = "This task has no section — edit it to assign one.";
    badgeWrap.append(unassigned);
  }
  header.append(title, badgeWrap);

  // workload bar
  const bar  = document.createElement("div"); bar.className  = "task-workload-bar";
  const fill = document.createElement("div"); fill.className = "task-workload-fill";
  fill.style.width = `${fillPct}%`;
  bar.append(fill);

  // meta
  const metaRow = document.createElement("div");
  metaRow.className = "task-meta";

  const deadlineBlock = document.createElement("p");
  const deadlineLabel = document.createElement("strong");
  deadlineLabel.textContent = "Deadline";
  deadlineBlock.append(deadlineLabel, formatDeadline(task.deadline, task.deadlineTime || ""));

  if(dueSoon){
    const urgentTag = document.createElement("span");
    urgentTag.className   = "task-deadline-urgent";
    urgentTag.textContent = "Due soon";
    deadlineBlock.append(urgentTag);
  }

  metaRow.append(
    createMetaItem("Subject", task.subject),
    createMetaItem("Intensity", `${effort} / 5`),
    deadlineBlock
  );

  const children = [header, bar, metaRow];

  // Ownership line — shown to teachers/admins for every task.
  if(_canEdit){
    const ownerLine = document.createElement("p");
    ownerLine.className = "task-created-by";
    const ownerEmail = task.createdByEmail || "Unknown";
    ownerLine.innerHTML = `<strong>Created by:</strong> <span>${ownerEmail}</span>`;
    children.push(ownerLine);
  }

  // Edit / Delete only for tasks the current user may modify (owner or admin).
  if(canModifyTask(task)){
    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editButton = document.createElement("button");
    editButton.type                    = "button";
    editButton.className               = "secondary-button";
    editButton.dataset.action          = "edit";
    editButton.dataset.id              = taskDoc.id;
    editButton.dataset.title           = task.title || "";
    editButton.dataset.subject         = task.subject || "";
    editButton.dataset.taskType        = getTaskType(task);
    editButton.dataset.effortScore     = String(effort);
    editButton.dataset.movable         = String(flexible);
    editButton.dataset.deadline        = task.deadline || "";
    editButton.dataset.deadlineTime    = task.deadlineTime || "";
    editButton.dataset.sectionIds      = JSON.stringify(getTaskSections(task));
    editButton.textContent = "Edit";

    const deleteButton = document.createElement("button");
    deleteButton.type             = "button";
    deleteButton.className        = "danger-button";
    deleteButton.dataset.action   = "delete";
    deleteButton.dataset.id       = taskDoc.id;
    deleteButton.dataset.title    = task.title || "this task";
    deleteButton.textContent = "Delete";

    actions.append(editButton, deleteButton);
    children.push(actions);
  }

  article.append(...children);
  return article;
}

/* ── Render ── */
function renderEmptyState(message){
  const empty = document.createElement("div");
  empty.className   = "empty-state";
  empty.textContent = message;
  taskList.append(empty);
}

function renderGroups(groups, canEdit){
  const frag = document.createDocumentFragment();
  groups.forEach((group) => {
    const header = document.createElement("div");
    header.className = `task-group-header ${group.cls}`;
    header.innerHTML = `
      <span class="task-group-label">${group.label}</span>
      <span class="task-group-count">${group.docs.length}</span>`;
    frag.append(header);
    group.docs.forEach((d) => frag.append(createTaskItem(d)));
  });
  taskList.append(frag);
}

/* ── Load tasks ── */
async function loadTasks(){
  taskList.innerHTML = "";
  renderEmptyState("Loading tasks…");

  const searchValue  = searchInput?.value?.trim().toLowerCase() || "";
  const filterValue  = filterWorkload?.value || "all";
  const sectionValue = filterSection?.value || "all";

  try{
    const snap    = await getDocs(collection(db, "tasks"));
    const matched = [];
    _tasksById = {};

    snap.forEach((d) => {
      const task      = d.data();
      _tasksById[d.id] = task;   // for ownership checks in the action handlers
      const searchable = `${task.title || ""} ${task.subject || ""}`.toLowerCase();

      // Section filter — a task matches if ANY of its sections matches.
      // Students see only their section; teachers see their sections (plus
      // unassigned legacy tasks so they can fix them); admins see everything.
      const secs = getTaskSections(task);   // [] = unassigned
      let sectionMatch;
      if(!_canEdit){
        sectionMatch = _userSection ? secs.includes(_userSection) : false;
      }
      else if(_isAdmin){
        sectionMatch = sectionValue === "all" ? true : secs.includes(sectionValue);
      }
      else if(sectionValue === "all"){
        sectionMatch = secs.length === 0 || secs.some((s) => _userSections.includes(s));
      }
      else{
        sectionMatch = secs.includes(sectionValue);
      }

      const matchSearch = searchable.includes(searchValue);
      const matchFilter = filterValue === "all" || getTaskType(task) === filterValue;

      if(matchSearch && matchFilter && sectionMatch) matched.push(d);
    });

    taskList.innerHTML = "";

    if(matched.length === 0){
      renderEmptyState("No tasks match the current filters.");
      return;
    }

    const groups = buildGroups(matched);
    renderGroups(groups, _canEdit);
  }
  catch(error){
    console.error("Unable to load tasks", error);
    taskList.innerHTML = "";
    renderEmptyState("Tasks could not be loaded. Check your Firebase connection.");
  }
}

/* ── Form submit ── */
taskForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const taskData = getTaskFormData();

  if(!taskData.title || !taskData.subject || !taskData.deadline){
    showToast("Complete all required fields before saving.");
    return;
  }

  if(!taskData.sectionIds.length){
    showToast("Select at least one section before saving.");
    return;
  }

  // Ownership guard: teachers may only edit tasks they created.
  if(editingTaskId && !canModifyTask(_tasksById[editingTaskId])){
    showToast("You can only edit tasks you created.");
    return;
  }

  saveTaskBtn.disabled = true;

  try{
    if(editingTaskId){
      // Update never rewrites ownership (createdBy/createdByEmail/createdAt preserved).
      await updateDoc(firestoreDoc(db, "tasks", editingTaskId), taskData);
      showToast("Task updated successfully.");
    }
    else{
      await addDoc(collection(db, "tasks"), {
        ...taskData,
        createdBy:      _currentUid,
        createdByEmail: _currentEmail,
        createdAt:      new Date().toISOString()
      });
      showToast("Task saved successfully.");
    }
    resetTaskForm();
    await loadTasks();
  }
  catch(error){
    showToast(error.message || "Could not save task.");
  }
  finally{
    saveTaskBtn.disabled = false;
  }
});

cancelEditBtn?.addEventListener("click", resetTaskForm);

/* ── Task list actions (edit / delete) ── */
taskList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if(!button) return;

  const { action, id } = button.dataset;

  // Ownership guard (buttons are already hidden for non-owners; this is belt-and-suspenders).
  if(!canModifyTask(_tasksById[id])){
    showToast("You don't have permission to modify this task.");
    return;
  }

  if(action === "edit"){
    editingTaskId = id;
    titleInput.value    = button.dataset.title;
    subjectInput.value  = button.dataset.subject;
    taskTypeInput.value = button.dataset.taskType || "assignment";
    if(effortInput)  effortInput.value    = button.dataset.effortScore || "1";
    if(movableInput) movableInput.checked = button.dataset.movable === "true";
    deadlineInput.value = button.dataset.deadline;
    if(deadlineTimeInput) deadlineTimeInput.value = button.dataset.deadlineTime || "";
    try{ _editingOriginalSections = JSON.parse(button.dataset.sectionIds || "[]"); }
    catch{ _editingOriginalSections = []; }
    if(!Array.isArray(_editingOriginalSections)) _editingOriginalSections = [];
    setCheckedSectionIds(_editingOriginalSections);

    saveTaskBtn.textContent   = "Update Task";
    taskFormTitle.textContent = "Edit Academic Task";
    cancelEditBtn.classList.remove("is-hidden");
    taskForm.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  if(action === "delete"){
    openDeleteConfirmation(id, button.dataset.title, button);
  }
});

cancelDeleteBtn?.addEventListener("click", () => closeDeleteConfirmation());

deleteConfirmBackdrop?.addEventListener("click", (event) => {
  if(event.target === deleteConfirmBackdrop) closeDeleteConfirmation();
});

document.addEventListener("keydown", (event) => {
  if(event.key === "Escape" && deleteConfirmBackdrop?.classList.contains("is-open")){
    closeDeleteConfirmation();
  }
});

confirmDeleteBtn?.addEventListener("click", async () => {
  if(!pendingDeleteId) return;

  const taskId = pendingDeleteId;
  confirmDeleteBtn.disabled = true;
  cancelDeleteBtn.disabled  = true;
  confirmDeleteBtn.textContent = "Deleting...";

  try{
    await deleteDoc(firestoreDoc(db, "tasks", taskId));
    closeDeleteConfirmation({ restoreFocus:false });
    showToast("Task deleted.");
    await loadTasks();
  }
  catch(error){
    showToast(error.message || "Could not delete task.");
  }
  finally{
    confirmDeleteBtn.disabled = false;
    cancelDeleteBtn.disabled  = false;
    confirmDeleteBtn.textContent = "Delete task";
  }
});

searchInput?.addEventListener("input",   loadTasks);
filterWorkload?.addEventListener("change", loadTasks);
filterSection?.addEventListener("change", loadTasks);

/* ── Init ── */
initNav(async (user, role) => {
  const normalizedRole = (role || "").toLowerCase();
  const canEdit = ["teacher", "faculty", "admin"].includes(normalizedRole);
  _canEdit      = canEdit;
  _isAdmin      = normalizedRole === "admin";
  _currentUid   = user?.uid || "";
  _currentEmail = user?.email || "";
  _userSection  = localStorage.getItem("userSection") || "";
  try{
    const storedSections = JSON.parse(localStorage.getItem("userSections") || "[]");
    _userSections = Array.isArray(storedSections) ? storedSections : [];
  }
  catch{
    _userSections = [];
  }

  // Load sections first, then tasks
  _sectionsMap = await loadSectionsMap();
  const availableSections = _isAdmin || !canEdit
    ? _sectionsMap
    : Object.fromEntries(
      Object.entries(_sectionsMap).filter(([id]) => _userSections.includes(id))
    );
  renderSectionCheckboxes(availableSections);   // assignable sections in the form
  populateFilterSection(availableSections);     // filter scoped to what the user can see

  // Hide section form field for students (they can't create tasks)
  if(sectionField) sectionField.style.display = canEdit ? "" : "none";

  // Sync effort + flexibility defaults to the initially-selected type
  if(canEdit) applyTypeDefaults();

  // Hide section filter for students (auto-filtered to their section)
  if(filterSection){
    filterSection.style.display = canEdit ? "" : "none";
  }

  if(!canEdit){
    document.querySelector(".task-panel")?.classList.add("is-hidden");

    const notice = document.createElement("div");
    notice.className = "read-only-notice";
    notice.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      You are viewing tasks in read-only mode. Only teachers and administrators can add or edit tasks.`;
    document.querySelector(".tasks-section")?.before(notice);

    if(!_userSection){
      const sectionNotice = document.createElement("div");
      sectionNotice.className = "read-only-notice";
      sectionNotice.style.marginTop = "8px";
      sectionNotice.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        You have not been assigned to a section yet. Ask your teacher or admin to assign you.`;
      document.querySelector(".tasks-section")?.before(sectionNotice);
    }
  }

  loadTasks();
});
