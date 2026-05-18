const state = {
  contacts: JSON.parse(localStorage.getItem("crm_contacts") || "[]"),
  leads: JSON.parse(localStorage.getItem("crm_leads") || "[]"),
  tasks: JSON.parse(localStorage.getItem("crm_tasks") || "[]")
};

const contactForm = document.getElementById("contactForm");
const leadForm = document.getElementById("leadForm");
const taskForm = document.getElementById("taskForm");

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const contact = {
    id: crypto.randomUUID(),
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    company: document.getElementById("company").value.trim()
  };
  state.contacts.push(contact);
  contactForm.reset();
  persistAndRender();
});

leadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const lead = {
    id: crypto.randomUUID(),
    title: document.getElementById("leadName").value.trim(),
    stage: document.getElementById("leadStage").value,
    value: Number(document.getElementById("leadValue").value)
  };
  state.leads.push(lead);
  leadForm.reset();
  persistAndRender();
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const task = {
    id: crypto.randomUUID(),
    title: document.getElementById("taskTitle").value.trim(),
    dueDate: document.getElementById("taskDate").value,
    done: false
  };
  state.tasks.push(task);
  taskForm.reset();
  persistAndRender();
});

function persistAndRender() {
  localStorage.setItem("crm_contacts", JSON.stringify(state.contacts));
  localStorage.setItem("crm_leads", JSON.stringify(state.leads));
  localStorage.setItem("crm_tasks", JSON.stringify(state.tasks));
  render();
}

function render() {
  document.getElementById("contactCount").textContent = state.contacts.length;
  document.getElementById("leadCount").textContent = state.leads.length;
  document.getElementById("openTaskCount").textContent = state.tasks.filter((task) => !task.done).length;

  document.getElementById("contactList").innerHTML = state.contacts
    .map((contact) => `<li><strong>${contact.name}</strong><br>${contact.company}<br>${contact.email} | ${contact.phone}</li>`)
    .join("");

  document.getElementById("leadList").innerHTML = state.leads
    .map((lead) => `<li><strong>${lead.title}</strong><br>Stage: ${lead.stage}<br>Value: ₹${lead.value.toLocaleString()}</li>`)
    .join("");

  document.getElementById("taskList").innerHTML = state.tasks
    .map(
      (task) =>
        `<li>
          <label class="${task.done ? "task-done" : ""}">
            <input type="checkbox" ${task.done ? "checked" : ""} onchange="toggleTask('${task.id}')" />
            ${task.title} (Due: ${task.dueDate})
          </label>
        </li>`
    )
    .join("");
}

window.toggleTask = (id) => {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = !task.done;
  persistAndRender();
};

render();
