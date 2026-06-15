import { db } from "./firebase-config.js";

import {
    collection,
    addDoc,
    getDocs,
    deleteDoc,
    doc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function showToast(message){

  const toast =
    document.getElementById("toast");

  toast.textContent = message;

  toast.classList.add("show");

  setTimeout(() => {

    toast.classList.remove("show");

  }, 3000);

}

const saveTaskBtn = document.getElementById("saveTaskBtn");
const taskList = document.getElementById("taskList");

saveTaskBtn.addEventListener("click", async () => {

  const title = document.getElementById("title").value;
  const subject = document.getElementById("subject").value;
  const workloadScore = parseInt(
    document.getElementById("taskType").value
  );

  const deadline = document.getElementById("deadline").value;

  try {

    await addDoc(collection(db, "tasks"), {
      title,
      subject,
      workloadScore,
      deadline,
      createdAt: new Date()
    });

    showToast("Task saved successfully!");

    loadTasks();

  } catch (error) {

    alert(error.message);

  }

});

async function loadTasks(){

  taskList.innerHTML = "";

  const searchValue =
    document.getElementById("searchInput")
    ?.value
    ?.toLowerCase() || "";

  const filterValue =
    document.getElementById("filterWorkload")
    ?.value || "all";

  const querySnapshot = await getDocs(
    collection(db, "tasks")
  );

  querySnapshot.forEach((doc) => {

    const task = doc.data();

    const matchesSearch =
      task.title.toLowerCase()
      .includes(searchValue);

    const matchesFilter =
      filterValue === "all" ||
      task.workloadScore == filterValue;

    if(matchesSearch && matchesFilter){

      taskList.innerHTML += `
        <div class="task-item">

          <h3>${task.title}</h3>

          <p>Subject: ${task.subject}</p>

          <p>Workload Score: ${task.workloadScore}</p>

          <p>Deadline: ${task.deadline}</p>

          <button onclick="editTask(
            '${doc.id}',
            '${task.title}',
            '${task.subject}',
            '${task.workloadScore}',
            '${task.deadline}'
          )">
            Edit
          </button>

          <button onclick="deleteTask('${doc.id}')">
            Delete
          </button>

        </div>
      `;

    }

  });

}

loadTasks();

window.editTask = function(
  id,
  title,
  subject,
  workloadScore,
  deadline
){

  document.getElementById("title").value =
    title;

  document.getElementById("subject").value =
    subject;

  document.getElementById("taskType").value =
    workloadScore;

  document.getElementById("deadline").value =
    deadline;

  saveTaskBtn.textContent = "Update Task";

  saveTaskBtn.onclick = async function(){

    try{

      await updateDoc(
        doc(db, "tasks", id),
        {
          title:
            document.getElementById("title").value,

          subject:
            document.getElementById("subject").value,

          workloadScore:
            parseInt(
              document.getElementById("taskType").value
            ),

          deadline:
            document.getElementById("deadline").value
        }
      );

      showToast("Task updated successfully!");

      location.reload();

    }
    catch(error){

      alert(error.message);

    }

  };

}

window.deleteTask = async function(id){

  try{

    await deleteDoc(doc(db, "tasks", id));

    showToast("Task deleted successfully!");

    loadTasks();

  }
  catch(error){

    alert(error.message);

  }

}

document
  .getElementById("searchInput")
  ?.addEventListener("input", loadTasks);

document
  .getElementById("filterWorkload")
  ?.addEventListener("change", loadTasks);