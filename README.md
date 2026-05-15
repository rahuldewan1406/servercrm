# CRM Software for Organisation

A lightweight CRM starter app for managing:
- Contacts
- Sales leads
- Follow-up tasks

## Features
- Dashboard with live counters
- Add and view contacts
- Add and view leads with stage and estimated value
- Add and complete follow-up tasks
- Persistent storage using browser localStorage

## Run the project
This project is a static web app.

1. Open `index.html` directly in your browser, **or**
2. Serve with a local server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Suggested next upgrades
- Multi-user login with role-based access
- Backend database (PostgreSQL / MySQL)
- Lead assignment and pipeline analytics
- Activity timeline and email/SMS integration
- Import/export via CSV
