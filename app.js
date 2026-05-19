const state = {
  contacts: JSON.parse(localStorage.getItem("crm_contacts") || "[]"),
  leads: JSON.parse(localStorage.getItem("crm_leads") || "[]"),
  opportunities: JSON.parse(localStorage.getItem("crm_opportunities") || "[]"),
  accounts: JSON.parse(localStorage.getItem("crm_accounts") || "[]"),
  projects: JSON.parse(localStorage.getItem("crm_projects") || "[]"),
  activities: JSON.parse(localStorage.getItem("crm_activities") || "[]"),
  tickets: JSON.parse(localStorage.getItem("crm_tickets") || "[]"),
  session: JSON.parse(localStorage.getItem("crm_session") || "null")
};

const q = (id) => document.getElementById(id);
const navButtons = [...document.querySelectorAll(".nav-btn")];
navButtons.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
q("ticketFilter").addEventListener("change", render);
q("customerSelect").addEventListener("change", renderCustomer360);

bindForm("contactForm", () => state.contacts.push({ id: crypto.randomUUID(), name: q("name").value.trim(), email: q("email").value.trim(), secondaryEmail: q("secondaryEmail").value.trim(), phone: q("phone").value.trim(), company: q("company").value.trim(), gender: q("gender").value, age: Number(q("age").value), location: q("location").value.trim() }));
bindForm("accountForm", () => state.accounts.push({ id: crypto.randomUUID(), name: q("accountName").value.trim(), tier: q("accountTier").value, renewalDate: q("renewalDate").value }));
bindForm("leadForm", () => state.leads.push({ id: crypto.randomUUID(), contactId: q("leadContact").value || null, title: q("leadName").value.trim(), stage: q("leadStage").value, value: Number(q("leadValue").value) }));
bindForm("opportunityForm", () => state.opportunities.push({ id: crypto.randomUUID(), name: q("oppName").value.trim(), value: Number(q("oppValue").value), probability: Number(q("oppProbability").value) }));
bindForm("projectForm", () => state.projects.push({ id: crypto.randomUUID(), contactId: q("projectContact").value || null, name: q("projectName").value.trim(), status: q("projectStatus").value, manager: q("projectManager").value.trim() }));
bindForm("activityForm", () => state.activities.unshift({ id: crypto.randomUUID(), contactId: q("activityContact").value || null, type: q("activityType").value, note: q("activityNote").value.trim(), at: new Date().toISOString() }));
bindForm("ticketForm", () => state.tickets.push({ id: crypto.randomUUID(), contactId: q("ticketContact").value || null, title: q("ticketTitle").value.trim(), priority: q("ticketPriority").value, status: q("ticketStatus").value }));
q("mailForm").addEventListener("submit", sendMail);

q("loginBtn").addEventListener("click", () => q("loginDialog").showModal());
q("closeLogin").addEventListener("click", () => q("loginDialog").close());
q("logoutBtn").addEventListener("click", logout);
q("loginForm").addEventListener("submit", login);

function setStatus(element, message, type = "info") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("status-info", "status-warning", "status-error");
  element.classList.add(type === "warning" ? "status-warning" : type === "error" ? "status-error" : "status-info");
}

async function checkSmtpApi() {
  const statusEl = q("smtpStatus");
  try {
    const response = await fetch("http://localhost:3001/api/health");
    const data = await response.json();
    if (!response.ok || data.status !== "ok") {
      setStatus(statusEl, "SMTP API is unavailable. Email sending will fallback to mailto links.", "warning");
      return false;
    }
    setStatus(statusEl, "SMTP API is available.", "info");
    return true;
  } catch (error) {
    setStatus(statusEl, "SMTP API is unreachable. Email sending will fallback to mailto links.", "warning");
    return false;
  }
}

function login(event) {
  event.preventDefault();
  const email = q("loginEmail").value.trim().toLowerCase();
  const password = q("loginPassword").value;
  if (email === "admin@crm.local" && password === "admin123") {
    state.session = { email, name: "CRM Admin" };
    localStorage.setItem("crm_session", JSON.stringify(state.session));
    q("loginStatus").textContent = "Login successful.";
    q("loginForm").reset();
    q("loginDialog").close();
    renderSession();
    return;
  }
  q("loginStatus").textContent = "Invalid credentials.";
}

function logout() {
  state.session = null;
  localStorage.removeItem("crm_session");
  renderSession();
}

function renderSession() {
  const loggedIn = Boolean(state.session);
  q("userBadge").textContent = loggedIn ? state.session.name : "Guest";
  q("loginBtn").classList.toggle("hidden", loggedIn);
  q("logoutBtn").classList.toggle("hidden", !loggedIn);
}

function bindForm(id, handler) {
  q(id).addEventListener("submit", (event) => {
    event.preventDefault();
    handler();
    event.target.reset();
    persistAndRender();
  });
}

async function sendMail(event) {
  event.preventDefault();
  const mode = q("mailMode").value;
  const recipients = mode === "bulk"
    ? state.contacts.flatMap((c) => [c.email, c.secondaryEmail]).filter(Boolean)
    : mode === "multi"
      ? q("mailTo").value.split(",").map((v) => v.trim()).filter(Boolean)
      : [q("mailTo").value.trim()].filter(Boolean);

  const payload = { recipients, subject: q("mailSubject").value.trim(), body: q("mailBody").value.trim() };
  if (!payload.recipients.length) {
    setStatus(q("mailStatus"), "Please provide at least one recipient.", "warning");
    return;
  }
  if (!payload.subject || !payload.body) {
    setStatus(q("mailStatus"), "Please complete subject and message.", "warning");
    return;
  }

  const mailEl = q("mailStatus");
  const smtpEl = q("smtpStatus");
  setStatus(mailEl, "Sending via SMTP API...", "info");
  try {
    const response = await fetch("http://localhost:3001/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "SMTP API error");
    setStatus(mailEl, data.message || "Email sent.", "info");
    q("mailForm").reset();
    await checkSmtpApi();
  } catch (error) {
    const mailto = `mailto:${encodeURIComponent(payload.recipients[0])}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
    mailEl.innerHTML = `SMTP unavailable. <a href="${mailto}">Open email client</a> as fallback.`;
    setStatus(smtpEl, "SMTP API request failed. Check backend or environment settings.", "error");
    console.error('Send mail failed:', error);
  }
}

function switchTab(id) { document.querySelectorAll(".tab").forEach((n) => n.classList.remove("active")); navButtons.forEach((n) => n.classList.remove("active")); q(id).classList.add("active"); document.querySelector(`.nav-btn[data-tab="${id}"]`).classList.add("active"); }
function persistAndRender() { Object.entries({ crm_contacts: state.contacts, crm_leads: state.leads, crm_opportunities: state.opportunities, crm_accounts: state.accounts, crm_projects: state.projects, crm_activities: state.activities, crm_tickets: state.tickets }).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))); render(); }
function renderCustomer360() {
  const c = state.contacts.find((x) => x.id === q("customerSelect").value);
  if (!c) { q("customer360").textContent = "Select a customer to view full profile."; return; }

  const cid = c.id;
  const myTickets = state.tickets.filter((t) => t.contactId === cid);
  const myLeads = state.leads.filter((l) => l.contactId === cid);
  const myProjects = state.projects.filter((p) => p.contactId === cid);
  const myActivities = state.activities.filter((a) => a.contactId === cid);

  const openTickets = myTickets.filter((t) => t.status === "Open").length;
  const inProgressTickets = myTickets.filter((t) => t.status === "In Progress").length;
  const resolvedTickets = myTickets.filter((t) => t.status === "Resolved").length;
  const activeProjects = myProjects.filter((p) => p.status === "Active").length;
  const wonLeads = myLeads.filter((l) => l.stage === "Won").length;
  const totalLeadValue = myLeads.reduce((s, l) => s + (l.value || 0), 0);

  const ticketRows = myTickets.length
    ? myTickets.map((t) => `<li>${t.title} — <em>${t.priority}</em> · <strong>${t.status}</strong></li>`).join("")
    : "<li class='muted'>No tickets linked.</li>";

  const leadRows = myLeads.length
    ? myLeads.map((l) => `<li>${l.title} — ${l.stage} · ₹${l.value.toLocaleString()}</li>`).join("")
    : "<li class='muted'>No leads linked.</li>";

  const projectRows = myProjects.length
    ? myProjects.map((p) => `<li>${p.name} — ${p.status} · PM: ${p.manager}</li>`).join("")
    : "<li class='muted'>No projects linked.</li>";

  const activityRows = myActivities.length
    ? myActivities.slice(0, 5).map((a) => `<li><strong>${a.type}</strong>: ${a.note}</li>`).join("")
    : "<li class='muted'>No activities logged.</li>";

  q("customer360").innerHTML = `
    <div class="c360-header">
      <strong class="c360-name">${c.name}</strong>
      <span class="c360-company">${c.company} · ${c.location}</span>
    </div>
    <div class="c360-contact">
      📧 ${c.email}${c.secondaryEmail ? ` · ${c.secondaryEmail}` : ""}
      &nbsp;|&nbsp; 📞 ${c.phone || "—"}
      &nbsp;|&nbsp; 🧑 ${c.gender}, ${c.age} yrs
    </div>
    <div class="c360-stats">
      <div><span>${openTickets}</span><small>Open Tickets</small></div>
      <div><span>${inProgressTickets}</span><small>In Progress</small></div>
      <div><span>${resolvedTickets}</span><small>Resolved</small></div>
      <div><span>${activeProjects}</span><small>Active Projects</small></div>
      <div><span>${wonLeads}/${myLeads.length}</span><small>Leads Won</small></div>
      <div><span>₹${totalLeadValue.toLocaleString()}</span><small>Total Lead Value</small></div>
    </div>
    <div class="c360-section"><h4>Tickets</h4><ul>${ticketRows}</ul></div>
    <div class="c360-section"><h4>Leads</h4><ul>${leadRows}</ul></div>
    <div class="c360-section"><h4>Projects</h4><ul>${projectRows}</ul></div>
    <div class="c360-section"><h4>Recent Activities</h4><ul>${activityRows}</ul></div>
  `;
}
function render() { const today = new Date(); const in30 = new Date(Date.now() + 30 * 86400000); const renewalsDue = state.accounts.filter((a) => a.renewalDate && new Date(a.renewalDate) >= today && new Date(a.renewalDate) <= in30).length; const open = state.tickets.filter((t) => t.status === "Open").length, progress = state.tickets.filter((t) => t.status === "In Progress").length, resolved = state.tickets.filter((t) => t.status === "Resolved").length; q("contactCount").textContent = state.contacts.length; q("leadCount").textContent = state.leads.length; q("opportunityCount").textContent = state.opportunities.length; q("ticketOpenCount").textContent = open; q("renewalDueCount").textContent = renewalsDue; q("projectActiveCount").textContent = state.projects.filter((p) => p.status === "Active").length; q("ticketInProgressCount").textContent = progress; q("ticketResolvedCount").textContent = resolved;
q("contactList").innerHTML = state.contacts.map((c) => `<li><strong>${c.name}</strong> — ${c.company}<br>${c.email}<div class="row-actions"><button class="btn-edit" onclick="openEditDialog('contacts','${c.id}')">Edit</button><button class="btn-delete" onclick="deleteRecord('contacts','${c.id}')">Delete</button></div></li>`).join(""); q("accountList").innerHTML = state.accounts.map((a) => `<li><strong>${a.name}</strong> (${a.tier})<br>Renewal: ${a.renewalDate}</li>`).join(""); q("leadList").innerHTML = state.leads.map((l) => `<li><strong>${l.title}</strong><br>${l.stage} • ₹${l.value.toLocaleString()}<div class="row-actions"><button class="btn-edit" onclick="openEditDialog('leads','${l.id}')">Edit</button><button class="btn-delete" onclick="deleteRecord('leads','${l.id}')">Delete</button></div></li>`).join(""); q("opportunityList").innerHTML = state.opportunities.map((o) => `<li><strong>${o.name}</strong><br>₹${o.value.toLocaleString()} @ ${o.probability}%</li>`).join(""); q("weightedForecast").textContent = state.opportunities.reduce((s, o) => s + (o.value * o.probability / 100), 0).toLocaleString(); q("projectList").innerHTML = state.projects.map((p) => `<li><strong>${p.name}</strong><br>${p.status} • PM: ${p.manager}</li>`).join(""); q("activityList").innerHTML = state.activities.slice(0, 8).map((a) => `<li><strong>${a.type}</strong><br>${a.note}</li>`).join(""); const filter = q("ticketFilter").value; const tks = filter === "All" ? state.tickets : state.tickets.filter((t) => t.status === filter); q("ticketList").innerHTML = tks.map((t) => `<li><strong>${t.title}</strong><br>${t.priority} • ${t.status}<div class="row-actions"><button class="btn-edit" onclick="openEditDialog('tickets','${t.id}')">Edit</button><button class="btn-delete" onclick="deleteRecord('tickets','${t.id}')">Delete</button></div></li>`).join(""); const total = Math.max(1, state.tickets.length); q("ticketAnalytics").innerHTML = [["Open", open], ["In Progress", progress], ["Resolved", resolved]].map(([l, v]) => `<div class='bar-row'><span>${l}</span><div class='bar'><i style='width:${(v / total) * 100}%'></i></div><b>${v}</b></div>`).join(""); q("customerSelect").innerHTML = `<option value="">Select customer</option>` + state.contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  const contactOptions = '<option value="">Link to Contact (optional)</option>' + state.contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  ["leadContact","projectContact","activityContact","ticketContact"].forEach((id) => { const el = q(id); if (el) el.innerHTML = contactOptions; }); renderCustomer360(); }

function deleteRecord(collection, id) {
  state[collection] = state[collection].filter((r) => r.id !== id);
  persistAndRender();
}

function openEditDialog(collection, id) {
  const record = state[collection].find((r) => r.id === id);
  if (!record) return;
  const dialog = q('editDialog');
  const title  = q('editDialogTitle');
  const body   = q('editDialogBody');
  const form   = q('editDialogForm');

  // Build form fields based on collection
  const fields = {
    contacts: [
      { id:'eName',           label:'Full Name',        type:'text',   key:'name' },
      { id:'eEmail',          label:'Primary Email',    type:'email',  key:'email' },
      { id:'eSecondaryEmail', label:'Secondary Email',  type:'text',   key:'secondaryEmail' },
      { id:'ePhone',          label:'Phone',            type:'text',   key:'phone' },
      { id:'eCompany',        label:'Company',          type:'text',   key:'company' },
      { id:'eLocation',       label:'Location',         type:'text',   key:'location' },
      { id:'eAge',            label:'Age',              type:'number', key:'age' },
    ],
    leads: [
      { id:'eLeadTitle', label:'Lead Title', type:'text',   key:'title' },
      { id:'eLeadValue', label:'Value (₹)',  type:'number', key:'value' },
    ],
    tickets: [
      { id:'eTicketTitle', label:'Ticket Title', type:'text', key:'title' },
    ],
  };

  const selectFields = {
    leads:   [{ id:'eLeadStage',    label:'Stage',    key:'stage',    options:['New','Qualified','Proposal','Won','Lost'] }],
    tickets: [
      { id:'eTicketPriority', label:'Priority', key:'priority', options:['Low','Medium','High'] },
      { id:'eTicketStatus',   label:'Status',   key:'status',   options:['Open','In Progress','Resolved'] },
    ],
    contacts: [{ id:'eGender', label:'Gender', key:'gender', options:['Female','Male','Other'] }],
  };

  const titleMap = { contacts:'Edit Contact', leads:'Edit Lead', tickets:'Edit Ticket' };
  title.textContent = titleMap[collection] || 'Edit';

  const textInputs = (fields[collection] || []).map(f =>
    `<label>${f.label}<input id="${f.id}" type="${f.type}" value="${record[f.key] ?? ''}" /></label>`
  ).join('');

  const selects = (selectFields[collection] || []).map(f =>
    `<label>${f.label}<select id="${f.id}">${f.options.map(o =>
      `<option${record[f.key]===o?' selected':''} value="${o}">${o}</option>`
    ).join('')}</select></label>`
  ).join('');

  body.innerHTML = textInputs + selects;

  form.onsubmit = (e) => {
    e.preventDefault();
    const idx = state[collection].findIndex((r) => r.id === id);
    if (idx === -1) return;

    (fields[collection] || []).forEach(f => {
      const el = q(f.id);
      if (!el) return;
      state[collection][idx][f.key] = f.type === 'number' ? Number(el.value) : el.value.trim();
    });
    (selectFields[collection] || []).forEach(f => {
      const el = q(f.id);
      if (el) state[collection][idx][f.key] = el.value;
    });

    persistAndRender();
    dialog.close();
  };

  dialog.showModal();
}

renderSession();
render();
checkSmtpApi();
