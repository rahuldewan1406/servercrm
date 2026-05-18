const state = {
  contacts: JSON.parse(localStorage.getItem("crm_contacts") || "[]"),
  leads: JSON.parse(localStorage.getItem("crm_leads") || "[]"),
  tasks: JSON.parse(localStorage.getItem("crm_tasks") || "[]"),
  tickets: JSON.parse(localStorage.getItem("crm_tickets") || "[]")
};

const contactForm = document.getElementById("contactForm");
const leadForm = document.getElementById("leadForm");
const taskForm = document.getElementById("taskForm");
const ticketForm = document.getElementById("ticketForm");
const mailForm = document.getElementById("mailForm");
const loginBtn = document.getElementById("loginBtn");
const customerSelect = document.getElementById("customerSelect");

loginBtn.addEventListener("click", () => {
  alert("Login module placeholder: connect to backend auth (JWT/RBAC) in next phase.");
});

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const contact = {
    id: crypto.randomUUID(),
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    secondaryEmail: document.getElementById("secondaryEmail").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    company: document.getElementById("company").value.trim(),
    gender: document.getElementById("gender").value,
    age: Number(document.getElementById("age").value),
    location: document.getElementById("location").value.trim()
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

ticketForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const ticket = {
    id: crypto.randomUUID(),
    title: document.getElementById("ticketTitle").value.trim(),
    priority: document.getElementById("ticketPriority").value,
    status: document.getElementById("ticketStatus").value
  };
  state.tickets.push(ticket);
  ticketForm.reset();
  persistAndRender();
});

mailForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const mode = document.getElementById("mailMode").value;
  const rawTo = document.getElementById("mailTo").value.trim();
  const subject = document.getElementById("mailSubject").value.trim();
  const body = document.getElementById("mailBody").value.trim();
  let recipients = [];

  if (mode === "bulk") {
    recipients = state.contacts.map((contact) => contact.email).filter(Boolean);
  } else if (mode === "multi") {
    recipients = rawTo.split(",").map((part) => part.trim()).filter(Boolean);
  } else {
    recipients = rawTo ? [rawTo] : [];
  }

  const statusEl = document.getElementById("mailStatus");
  if (!recipients.length || !subject || !body) {
    statusEl.textContent = "Please provide recipients, subject, and message.";
    return;
  }

  statusEl.textContent = `Mail queued (${mode}) to ${recipients.length} recipient(s). Integrate SMTP/API in backend to send for real.`;
  mailForm.reset();
});

customerSelect.addEventListener("change", (event) => {
  const selectedId = event.target.value;
  const contact = state.contacts.find((item) => item.id === selectedId);
  if (!contact) {
    document.getElementById("customer360").textContent = "Select a customer to view profile, leads, tasks, and ticket snapshot.";
    return;
  }

  const leadSnapshot = state.leads.slice(0, 3).map((lead) => `${lead.title} (${lead.stage})`).join(", ") || "None";
  const openTasks = state.tasks.filter((task) => !task.done).length;
  const openTickets = state.tickets.filter((ticket) => ticket.status === "Open").length;

  document.getElementById("customer360").innerHTML = `
    <strong>${contact.name}</strong><br>
    ${contact.company} • ${contact.location}<br>
    ${contact.email}${contact.secondaryEmail ? `, ${contact.secondaryEmail}` : ""}<br>
    Demographics: ${contact.gender}, ${contact.age} years<br>
    Open Tasks: ${openTasks} | Open Tickets: ${openTickets}<br>
    Recent Leads: ${leadSnapshot}
  `;
});

function persistAndRender() {
  localStorage.setItem("crm_contacts", JSON.stringify(state.contacts));
  localStorage.setItem("crm_leads", JSON.stringify(state.leads));
  localStorage.setItem("crm_tasks", JSON.stringify(state.tasks));
  localStorage.setItem("crm_tickets", JSON.stringify(state.tickets));
  render();
}

function render() {
  const openTickets = state.tickets.filter((ticket) => ticket.status === "Open").length;
  const inProgress = state.tickets.filter((ticket) => ticket.status === "In Progress").length;
  const resolved = state.tickets.filter((ticket) => ticket.status === "Resolved").length;

  document.getElementById("contactCount").textContent = state.contacts.length;
  document.getElementById("leadCount").textContent = state.leads.length;
  document.getElementById("openTaskCount").textContent = state.tasks.filter((task) => !task.done).length;
  document.getElementById("ticketOpenCount").textContent = openTickets;
  document.getElementById("ticketInProgressCount").textContent = inProgress;
  document.getElementById("ticketResolvedCount").textContent = resolved;

  document.getElementById("contactList").innerHTML = state.contacts.map((contact) => `
    <li><strong>${contact.name}</strong><br>${contact.company}<br>${contact.location}<br>${contact.email}${contact.secondaryEmail ? ` | ${contact.secondaryEmail}` : ""}</li>
  `).join("");

  document.getElementById("leadList").innerHTML = state.leads.map((lead) => `
    <li><strong>${lead.title}</strong><br>Stage: ${lead.stage}<br>Value: ₹${lead.value.toLocaleString()}</li>
  `).join("");

  document.getElementById("taskList").innerHTML = state.tasks.map((task) => `
    <li>
      <label class="${task.done ? "task-done" : ""}">
        <input type="checkbox" ${task.done ? "checked" : ""} onchange="toggleTask('${task.id}')" />
        ${task.title} (Due: ${task.dueDate})
      </label>
    </li>
  `).join("");

  document.getElementById("ticketList").innerHTML = state.tickets.map((ticket) => `
    <li><strong>${ticket.title}</strong><br>${ticket.priority} priority • ${ticket.status}</li>
  `).join("");

  customerSelect.innerHTML = `<option value="">Select customer</option>` + state.contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

window.toggleTask = (id) => {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = !task.done;
  persistAndRender();
};

render();
