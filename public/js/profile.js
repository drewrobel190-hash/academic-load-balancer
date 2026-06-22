import { auth, db } from "./firebase-config.js";
import { initNav } from "./nav.js";

import {
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const storage = getStorage(getApp());

/* ── DOM refs ── */
const profileAvatarLarge  = document.getElementById("profileAvatarLarge");
const profileAvatarImg    = document.getElementById("profileAvatarImg");
const profileAvatarInitial = document.getElementById("profileAvatarInitial");
const profileDisplayName  = document.getElementById("profileDisplayName");
const profileRoleBadge    = document.getElementById("profileRoleBadge");
const profileEmail        = document.getElementById("profileEmail");
const profileRoleText     = document.getElementById("profileRoleText");
const profileUid          = document.getElementById("profileUid");
const displayNameInput    = document.getElementById("displayNameInput");
const photoUrlInput       = document.getElementById("photoUrlInput");
const photoFileInput      = document.getElementById("photoFileInput");
const updateNameForm      = document.getElementById("updateNameForm");
const updateNameBtn       = document.getElementById("updateNameBtn");
const profileFormMsg      = document.getElementById("profileFormMsg");
const uploadOverlay       = document.getElementById("avatarUploadOverlay");
const avatarUploadBtn     = document.getElementById("avatarUploadBtn");

function showFormMsg(text, isError = false){
  if(!profileFormMsg) return;
  profileFormMsg.textContent = text;
  profileFormMsg.className = "profile-form-msg " + (isError ? "profile-form-error" : "profile-form-success");
}

function getRoleBadgeClass(role){
  if(!role) return "";
  switch(role.toLowerCase()){
    case "admin":   return "badge-admin";
    case "faculty": return "badge-faculty";
    default:        return "badge-student";
  }
}

function applyAvatar(photoURL, displayName, email){
  const initial = (displayName || email || "?").charAt(0).toUpperCase();

  if(profileAvatarImg && photoURL){
    profileAvatarImg.src           = photoURL;
    profileAvatarImg.style.display = "block";
    if(profileAvatarInitial) profileAvatarInitial.style.display = "none";
  }
  else{
    if(profileAvatarImg) profileAvatarImg.style.display = "none";
    if(profileAvatarInitial){
      profileAvatarInitial.textContent = initial;
      profileAvatarInitial.style.display = "";
    }
  }
}

function updateSidebarAvatar(photoURL, displayName, email){
  const sidebarAvatar = document.getElementById("sidebarAvatar");
  if(!sidebarAvatar) return;
  if(photoURL){
    sidebarAvatar.innerHTML  = `<img src="${photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    sidebarAvatar.style.padding  = "0";
    sidebarAvatar.style.overflow = "hidden";
  }
  else{
    sidebarAvatar.textContent = (displayName || email || "?").charAt(0).toUpperCase();
  }
}

/* ── Photo upload via Firebase Storage ── */
profileAvatarLarge?.addEventListener("click", () => {
  photoFileInput?.click();
});

avatarUploadBtn?.addEventListener("click", () => {
  photoFileInput?.click();
});

photoFileInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if(!file) return;

  if(!file.type.startsWith("image/")){
    showFormMsg("Please select an image file (PNG, JPG, GIF, etc.)", true);
    return;
  }
  if(file.size > 3 * 1024 * 1024){
    showFormMsg("Image must be under 3 MB.", true);
    return;
  }

  const user = auth.currentUser;
  if(!user) return;

  if(uploadOverlay) uploadOverlay.style.display = "flex";
  showFormMsg("Uploading photo…");

  try{
    const storageRef  = ref(storage, `avatars/${user.uid}`);
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);

    await updateProfile(user, { photoURL: downloadURL });

    if(photoUrlInput) photoUrlInput.value = downloadURL;
    applyAvatar(downloadURL, user.displayName, user.email);
    updateSidebarAvatar(downloadURL, user.displayName, user.email);
    showFormMsg("Profile photo updated successfully.");
  }
  catch(err){
    console.error("Upload error", err);
    showFormMsg(err.message || "Upload failed. Check Firebase Storage rules.", true);
  }
  finally{
    if(uploadOverlay) uploadOverlay.style.display = "none";
    // Reset file input so same file can be re-selected
    if(photoFileInput) photoFileInput.value = "";
  }
});

async function loadProfile(user){
  const email       = user.email || "";
  const displayName = user.displayName || "";
  const photoURL    = user.photoURL || "";

  applyAvatar(photoURL, displayName, email);

  if(profileDisplayName) profileDisplayName.textContent = displayName || email;
  if(profileEmail)       profileEmail.textContent       = email;
  if(profileUid)         profileUid.textContent         = user.uid;
  if(displayNameInput)   displayNameInput.value         = displayName;
  if(photoUrlInput)      photoUrlInput.value            = photoURL;

  try{
    const snap = await getDoc(doc(db, "users", email));
    if(snap.exists()){
      const role       = snap.data().role || "student";
      const badgeClass = getRoleBadgeClass(role);
      if(profileRoleBadge){
        profileRoleBadge.textContent = role;
        profileRoleBadge.className   = "profile-role-badge " + badgeClass;
      }
      if(profileRoleText) profileRoleText.textContent = role;
    }
  }
  catch(e){ console.error("Profile: could not load role", e); }
}

/* ── Save display name + optional URL ── */
updateNameForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const newName  = displayNameInput.value.trim();
  const manualURL = photoUrlInput?.value.trim() || null;

  if(!newName){
    showFormMsg("Display name cannot be empty.", true);
    return;
  }

  updateNameBtn.disabled    = true;
  updateNameBtn.textContent = "Saving…";

  try{
    const updates = { displayName: newName };
    if(manualURL) updates.photoURL = manualURL;

    await updateProfile(auth.currentUser, updates);

    const finalURL = manualURL || auth.currentUser.photoURL;
    if(profileDisplayName) profileDisplayName.textContent = newName;
    applyAvatar(finalURL, newName, auth.currentUser.email);
    updateSidebarAvatar(finalURL, newName, auth.currentUser.email);

    showFormMsg("Profile updated successfully.");
  }
  catch(e){
    showFormMsg(e.message || "Could not update profile.", true);
  }
  finally{
    updateNameBtn.disabled    = false;
    updateNameBtn.textContent = "Save Changes";
  }
});

initNav(loadProfile);
