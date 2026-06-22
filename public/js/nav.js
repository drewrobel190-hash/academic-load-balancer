import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ── Theme ── */
function applyTheme(){
  const isDark = localStorage.getItem("theme") === "dark";
  document.body.classList.toggle("dark-mode", isDark);
  updateDarkIcon(isDark);
}

function updateDarkIcon(isDark){
  const icon = document.getElementById("darkModeIcon");
  if(!icon) return;
  icon.innerHTML = isDark
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}

/* ── Mobile drawer ── */
function initMobileDrawer(){
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const toggle  = document.getElementById("menuToggle");

  function open(){
    sidebar?.classList.add("is-open");
    overlay?.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function close(){
    sidebar?.classList.remove("is-open");
    overlay?.classList.remove("active");
    document.body.style.overflow = "";
  }

  toggle?.addEventListener("click", open);
  overlay?.addEventListener("click", close);

  sidebar?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if(window.innerWidth <= 900) close();
    });
  });
}

/* ── Collapsible sidebar (desktop) ── */
function initCollapsibleSidebar(){
  const sidebar = document.querySelector(".sidebar");
  if(!sidebar) return;

  // Wrap text nodes in nav links with .nav-label spans
  sidebar.querySelectorAll("nav a").forEach((a) => {
    Array.from(a.childNodes).forEach((node) => {
      if(node.nodeType === Node.TEXT_NODE && node.textContent.trim()){
        const span = document.createElement("span");
        span.className = "nav-label";
        span.textContent = node.textContent.trim();
        a.replaceChild(span, node);
        a.dataset.label = span.textContent;
      }
    });
  });

  // Wrap .brand text node
  const brand = sidebar.querySelector(".brand");
  if(brand){
    Array.from(brand.childNodes).forEach((node) => {
      if(node.nodeType === Node.TEXT_NODE && node.textContent.trim()){
        const span = document.createElement("span");
        span.className = "nav-label";
        span.textContent = node.textContent.trim();
        brand.replaceChild(span, node);
      }
    });
  }

  // Inject collapse toggle into footer actions
  const footerActions = sidebar.querySelector(".sidebar-footer-actions");
  const collapseBtn   = document.createElement("button");
  collapseBtn.type    = "button";
  collapseBtn.id      = "sidebarCollapseBtn";
  collapseBtn.className = "sidebar-icon-btn sidebar-collapse-btn";

  const isCollapsed = localStorage.getItem("sidebarCollapsed") === "1";
  if(isCollapsed) document.body.classList.add("sidebar-collapsed");
  updateCollapseIcon(collapseBtn, isCollapsed);

  collapseBtn.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
    updateCollapseIcon(collapseBtn, collapsed);
  });

  footerActions?.append(collapseBtn);
}

function updateCollapseIcon(btn, isCollapsed){
  btn.title     = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  btn.ariaLabel = btn.title;
  btn.innerHTML = isCollapsed
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
}

/* ── Logout confirmation modal ── */
function createLogoutModal(){
  const existing = document.getElementById("logoutModal");
  if(existing) return existing;

  const modal = document.createElement("div");
  modal.id        = "logoutModal";
  modal.className = "confirm-modal-backdrop";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "logoutModalTitle");
  modal.innerHTML = `
    <div class="confirm-modal">
      <div class="confirm-modal-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </div>
      <h3 class="confirm-modal-title" id="logoutModalTitle">Log out?</h3>
      <p class="confirm-modal-body">You'll need to sign in again to access your dashboard.</p>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-btn confirm-btn--cancel" id="logoutCancelBtn">Stay</button>
        <button type="button" class="confirm-btn confirm-btn--danger" id="logoutConfirmBtn">Log out</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function showLogoutModal(onConfirm){
  showConfirmModal({
    title:      "Log out?",
    body:       "You'll need to sign in again to access your dashboard.",
    confirmLabel: "Log out",
    loadingLabel: "Logging out…",
    danger:     true,
    onConfirm
  });
}

/* ── Generic confirm modal (exported for other pages) ── */
export function showConfirmModal({ title, body, confirmLabel = "Confirm", loadingLabel, danger = false, onConfirm }){
  // Reuse existing backdrop or create fresh one
  let backdrop = document.getElementById("genericConfirmModal");
  if(!backdrop){
    backdrop = document.createElement("div");
    backdrop.id        = "genericConfirmModal";
    backdrop.className = "confirm-modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.innerHTML = `
      <div class="confirm-modal">
        <div class="confirm-modal-icon" id="gcmIcon"></div>
        <h3 class="confirm-modal-title" id="gcmTitle"></h3>
        <p  class="confirm-modal-body"  id="gcmBody"></p>
        <div class="confirm-modal-actions">
          <button type="button" class="confirm-btn confirm-btn--cancel" id="gcmCancel">Cancel</button>
          <button type="button" class="confirm-btn" id="gcmConfirm"></button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
  }

  const iconEl    = backdrop.querySelector("#gcmIcon");
  const titleEl   = backdrop.querySelector("#gcmTitle");
  const bodyEl    = backdrop.querySelector("#gcmBody");
  const cancelBtn = backdrop.querySelector("#gcmCancel");
  const confirmBtn= backdrop.querySelector("#gcmConfirm");

  // Danger (red) vs neutral (primary)
  confirmBtn.className = `confirm-btn ${danger ? "confirm-btn--danger" : "confirm-btn--primary"}`;

  iconEl.innerHTML = danger
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

  iconEl.style.background = danger ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)";
  iconEl.style.color      = danger ? "var(--danger)"        : "var(--primary)";

  titleEl.textContent   = title;
  bodyEl.textContent    = body || "";
  confirmBtn.textContent = confirmLabel;
  confirmBtn.disabled   = false;

  function close(){
    backdrop.classList.remove("is-open");
    document.removeEventListener("keydown", onKey);
    cancelBtn.onclick  = null;
    backdrop.onclick   = null;
    confirmBtn.onclick = null;
  }

  function onKey(e){ if(e.key === "Escape") close(); }

  cancelBtn.onclick  = close;
  backdrop.onclick   = (e) => { if(e.target === backdrop) close(); };
  document.addEventListener("keydown", onKey);

  confirmBtn.onclick = async () => {
    confirmBtn.textContent = loadingLabel || confirmLabel + "…";
    confirmBtn.disabled    = true;
    await onConfirm();
    close();
  };

  backdrop.classList.add("is-open");
  cancelBtn.focus();
}

/* ── Inject Admin nav link (admin role only) ── */
function injectAdminLink(navUl){
  if(!navUl || navUl.querySelector('a[href="admin.html"]')) return;

  const li = document.createElement("li");
  li.innerHTML = `<a href="admin.html">
    <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
    <span class="nav-label">Admin</span>
  </a>`;
  li.querySelector("a").dataset.label = "Admin";

  // Insert before Profile (last li)
  const lastLi = navUl.lastElementChild;
  navUl.insertBefore(li, lastLi);

  // Highlight if on admin.html
  if(window.location.pathname.endsWith("admin.html")){
    li.querySelector("a").setAttribute("aria-current", "page");
  }
}

/* ── Main nav init ── */
export function initNav(onReady){
  applyTheme();
  initMobileDrawer();
  initCollapsibleSidebar();

  const sidebarEmail  = document.getElementById("sidebarEmail");
  const sidebarRole   = document.getElementById("sidebarRole");
  const sidebarAvatar = document.getElementById("sidebarAvatar");
  const logoutBtn     = document.getElementById("logoutBtn");
  const darkToggle    = document.getElementById("darkModeToggle");

  darkToggle?.addEventListener("click", () => {
    const next = document.body.classList.contains("dark-mode") ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme();
  });

  logoutBtn?.addEventListener("click", () => {
    showLogoutModal(async () => {
      try{
        await signOut(auth);
        localStorage.removeItem("userEmail");
        localStorage.removeItem("userRole");
        localStorage.removeItem("userSection");
        localStorage.removeItem("userSections");
        window.location.href = "login.html";
      }
      catch(e){ console.error("Logout failed", e); }
    });
  });

  onAuthStateChanged(auth, async (user) => {
    if(!user){
      window.location.href = "login.html";
      return;
    }

    const email    = user.email || "";
    const photoURL = user.photoURL || "";
    localStorage.setItem("userEmail", email);

    if(sidebarEmail) sidebarEmail.textContent = email;

    if(sidebarAvatar){
      if(photoURL){
        sidebarAvatar.innerHTML  = `<img src="${photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        sidebarAvatar.style.padding  = "0";
        sidebarAvatar.style.overflow = "hidden";
      }
      else{
        sidebarAvatar.textContent = email.charAt(0).toUpperCase();
      }
    }

    let role = "student";

    try{
      const userRef = doc(db, "users", email);
      const snap    = await getDoc(userRef);

      if(snap.exists()){
        const profile = snap.data();
        role = profile.role || "student";

        if(role.toLowerCase() === "student"){
          localStorage.setItem("userSection", profile.sectionId || "");
          localStorage.setItem("userSections", "[]");
        }
        else if(["teacher", "faculty"].includes(role.toLowerCase())){
          const teacherSections = Array.isArray(profile.sectionIds)
            ? profile.sectionIds
            : (profile.sectionId ? [profile.sectionId] : []);
          localStorage.setItem("userSection", "");
          localStorage.setItem("userSections", JSON.stringify(teacherSections));
        }
        else{
          localStorage.setItem("userSection", "");
          localStorage.setItem("userSections", "[]");
        }
      }
      else{
        // First login — create document with default student role
        await setDoc(userRef, { role: "student", createdAt: new Date().toISOString() });
        console.info(`Created Firestore profile for ${email} (role: student). Update in Admin Panel.`);
        localStorage.setItem("userSection", "");
        localStorage.setItem("userSections", "[]");
      }

      localStorage.setItem("userRole", role);
      if(sidebarRole) sidebarRole.textContent = role;


      if(role.toLowerCase() === "admin"){
        injectAdminLink(document.querySelector(".sidebar nav ul"));
      }
    }
    catch(e){ console.error("Nav: could not load user role", e); }

    if(onReady) onReady(user, role);
  });
}
