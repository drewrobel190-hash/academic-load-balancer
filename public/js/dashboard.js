const ctx = document.getElementById("pressureChart");

import { db } from "./firebase-config.js";

import {
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const totalTasksEl = document.getElementById("totalTasks");
const pressureLevelEl = document.getElementById("pressureLevel");
const deadlinesEl = document.getElementById("deadlines");
const burnoutRiskEl =
  document.getElementById("burnoutRisk");
const warningBox =
  document.getElementById("warningBox");
const userEmailEl =
  document.getElementById("userEmail");

const userRoleEl =
  document.getElementById("userRole");

  async function loadUserRole(){

  const userEmail =
    localStorage.getItem("userEmail");

  const userRef =
    doc(db, "users", userEmail);

  const userSnap =
    await getDoc(userRef);

  if(userSnap.exists()){

    userEmailEl.textContent =
  userEmail;

    const userData = userSnap.data();
    userRoleEl.textContent =
  userData.role;

    if(userData.role === "student"){

      document.querySelector(
        'a[href="tasks.html"]'
      ).style.display = "none";

    }

  }

}

async function loadDashboard(){

  const querySnapshot = await getDocs(
    collection(db, "tasks")
  );

  let totalTasks = 0;
  let totalPressure = 0;

  const chartLabels = [];
  const chartData = [];

  querySnapshot.forEach((doc) => {

    const task = doc.data();

    totalTasks++;

    totalPressure += task.workloadScore;

    chartLabels.push(task.title);
    chartData.push(task.workloadScore);

  });

  totalTasksEl.textContent = totalTasks;

  deadlinesEl.textContent = totalTasks;

  let pressureLevel = "Low";

  if(totalPressure >= 8){
    pressureLevel = "High";
  }
  else if(totalPressure >= 4){
    pressureLevel = "Moderate";
  }

  pressureLevelEl.textContent = pressureLevel;

pressureLevelEl.className = "";

if(pressureLevel === "Low"){
  pressureLevelEl.classList.add("low");
}

else if(pressureLevel === "Moderate"){
  pressureLevelEl.classList.add("moderate");
}

else{
  pressureLevelEl.classList.add("high");
}
let burnoutRisk = "Low";

if(totalPressure >= 15){
  burnoutRisk = "High";
}
else if(totalPressure >= 8){
  burnoutRisk = "Moderate";
}

burnoutRiskEl.textContent = burnoutRisk;

burnoutRiskEl.className = "";

if(burnoutRisk === "Low"){
  burnoutRiskEl.classList.add("risk-low");
}

else if(burnoutRisk === "Moderate"){
  burnoutRiskEl.classList.add("risk-moderate");
}

else{
  burnoutRiskEl.classList.add("risk-high");
}

if(totalPressure >= 15){

  warningBox.textContent =
    "🚨 High Academic Pressure Detected! Students may experience burnout.";

  warningBox.classList.add("warning-high");

}

else if(totalPressure >= 8){

  warningBox.textContent =
    "⚠ Moderate workload detected. Monitor upcoming deadlines.";

}

else{

  warningBox.textContent =
    "✅ Academic workload is manageable.";

  warningBox.classList.add("warning-low");

}

  createChart(chartLabels, chartData);
  createCalendar(querySnapshot);

}

function createChart(labels, data){

  const ctx = document
    .getElementById("pressureChart");

  new Chart(ctx, {

    type: "bar",

    data: {
      labels: labels,
      datasets: [{
        label: "Task Workload",
        data: data,
        borderWidth: 2
      }]
    }

  });

}

const darkModeBtn =
  document.getElementById("darkModeBtn");

darkModeBtn?.addEventListener("click", () => {

  document.body.classList.toggle(
    "dark-mode"
  );

});

loadUserRole();
loadDashboard();

function createCalendar(querySnapshot){

  const calendarEl =
    document.getElementById("calendar");

  const events = [];

  querySnapshot.forEach((doc) => {

    const task = doc.data();

    let color = "green";

    if(task.workloadScore >= 5){
      color = "red";
    }

    else if(task.workloadScore >= 3){
      color = "orange";
    }

    events.push({
      title: task.title,
      start: task.deadline,
      color: color
    });

  });

  const calendar = new FullCalendar.Calendar(
    calendarEl,
    {
      initialView: "dayGridMonth",
      events: events
    }
  );

  calendar.render();

}