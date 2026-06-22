import { auth } from "./firebase-config.js";

import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const loginForm  = document.getElementById("loginForm");
const loginBtn   = document.getElementById("loginBtn");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginError     = document.getElementById("loginError");
const loginErrorText = document.getElementById("loginErrorText");

function showError(message){
  if(loginErrorText) loginErrorText.textContent = message;
  loginError.classList.remove("is-hidden");
}

function clearError(){
  if(loginErrorText) loginErrorText.textContent = "";
  loginError.classList.add("is-hidden");
}

function friendlyError(code){
  switch(code){
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password. Please try again.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your internet connection and try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const email    = emailInput.value.trim();
  const password = passwordInput.value;

  if(!email || !password){
    showError("Please enter your email and password.");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";

  try{
    await signInWithEmailAndPassword(auth, email, password);
    localStorage.setItem("userEmail", email);
    window.location.href = "dashboard.html";
  }
  catch(error){
    showError(friendlyError(error.code));
  }
  finally{
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";
  }
});
