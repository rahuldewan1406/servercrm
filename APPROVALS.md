# Project Approval Workflow

This guidance defines the approval steps required to move CRM project changes from planning to production.

## Approval roles

- **Product owner**: validates feature value, business fit, and acceptance criteria.
- **Engineering lead**: reviews architecture, code quality, and implementation strategy.
- **QA lead / tester**: validates functionality against requirements and catches regressions.
- **Security reviewer**: checks data handling, authentication, authorization, and SMTP/email behavior.
- **Release owner**: signs off on rollout readiness and deployment coordination.

## Approval steps

1. **Requirements review**
   - Confirm scope, user stories, and acceptance criteria.
   - Ensure CRM modules cover contacts, leads, tickets, accounts, projects, and email flows.
   - Document missing pieces or risks before development begins.

2. **Design review**
   - Review UI/UX wireframes or mockups for the frontend modules.
   - Validate backend API and SMTP integration design.
   - Confirm the proposed state model, localStorage persistence, and deployment plan.

3. **Implementation review**
   - Review code changes in the pull request.
   - Check architecture, naming, dependency usage, and maintainability.
   - Ensure the new `APPROVALS.md` workflow is linked and documented.

4. **QA and testing**
   - Validate user-facing flows: login, contact add/update, lead/opportunity creation, ticket dashboard, email center.
   - Verify frontend and backend are accessible on `http://localhost:8000` and `http://localhost:3001`.
   - Confirm fallback behavior when SMTP is missing or unavailable.

5. **Security and configuration review**
   - Confirm `.env.example` values are documented and no secrets are committed.
   - Verify email backend only sends mail when SMTP is configured.
   - Validate CORS and API exposure are properly handled for local development.

6. **Release sign-off**
   - Ensure documentation is updated (`README.md`, `APPROVALS.md`, `docs/RBAC_SETUP.md` when appropriate).
   - Confirm the app works locally and any known issues are logged.
   - Approve merge once all reviewers agree.

## Approval checklist template

- [ ] Business requirements reviewed and approved
- [ ] UI/UX and workflow design reviewed
- [ ] Code review completed
- [ ] QA testing executed and issues resolved
- [ ] SMTP/Email integration validated
- [ ] Security/config review completed
- [ ] Documentation updated
- [ ] Release sign-off obtained
