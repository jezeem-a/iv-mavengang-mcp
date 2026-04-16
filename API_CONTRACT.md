
# Backend API Contract — v1
**Product:** Maven Gang
**Status:** IMPLEMENTED — ALL ENDPOINTS LIVE
**Audience:** Backend Engineers, Frontend Engineers, AI Agents
**Style:** API-first, multi-tenant, monolith

---

## 0.1 Implementation Status

All endpoints in this contract are fully implemented and deployed to production.

**Last updated:** 2026-04-02

---

## 0. Global Conventions

### Base URL
```
/v1
```

### Authentication
- Bearer JWT
- Header:
```
Authorization: Bearer <token>
```

### Tenant Scoping (Hard Rule)
All non-auth endpoints MUST be scoped to an agency:

```
/v1/agencies/{agencyId}/...
```

Server MUST validate:
- User is a member of `{agencyId}`
- Role permissions are enforced per agency

---

### Roles (per agency)
- `admin` — Full control over agency, team, billing, settings
- `manager` — Can create projects, manage tasks, approve timesheets
- `staff` — Can work on projects, track time, submit timesheets
- `finance` — Can manage billing and invoices
- `client` — Limited read access to assigned projects and invoices

---

### ID Format
- CUID (string, generated via `@default(cuid())`)

---

### Timestamps
- ISO 8601 UTC
Example:
```
2026-01-08T12:00:00Z
```

---

### Pagination
Query params:
```
limit (default 20, max 100)
cursor (opaque string)
```

Response format:
```json
{
  "items": [],
  "next_cursor": "string | null"
}
```

---

### Standard Error Response

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

---

## 1. Authentication (Global)

### POST /auth/signup

Create a global user.

Request:

```json
{
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "password": "string"
}
```

Response `201`:

```json
{
  "access_token": "jwt",
  "refresh_token": "jwt",
  "user": {
    "id": "cuid",
    "firstName": "string",
    "lastName": "string",
    "email": "string",
    "created_at": "iso"
  }
}
```

Errors:

* `409 EMAIL_ALREADY_EXISTS`

---

### POST /auth/login

Request:

```json
{
  "email": "string",
  "password": "string"
}
```

Response `200`:

```json
{
  "access_token": "jwt",
  "refresh_token": "jwt",
  "user": {
    "id": "cuid",
    "firstName": "string",
    "lastName": "string",
    "email": "string"
  }
}
```

---

### POST /auth/forgot-password

Request password reset email.

Request:

```json
{
  "email": "string"
}
```

Response `200`:

```json
{
  "message": "If an account exists, a reset email has been sent"
}
```

---

### POST /auth/reset-password

Reset password with token.

Request:

```json
{
  "token": "string",
  "password": "string"
}
```

---

### POST /auth/change-password

Change password (authenticated).

Request:

```json
{
  "currentPassword": "string",
  "newPassword": "string"
}
```

---

### POST /auth/refresh

Rotate access + refresh tokens.

Request:

```json
{
  "refreshToken": "string"
}
```

Response `200`:

```json
{
  "access_token": "jwt",
  "refresh_token": "jwt"
}
```

Rules:
* Token rotation — old refresh token is invalidated
* Reuse detection clears all user tokens

---

### POST /auth/logout

Invalidate refresh token server-side.

Request:

```json
{
  "refreshToken": "string"
}
```

---

### GET /auth/me

Response:

```json
{
  "user": {
    "id": "cuid",
    "firstName": "string",
    "lastName": "string",
    "email": "string"
  },
  "memberships": [
    {
      "agency_id": "cuid",
      "agency_name": "string",
      "role": "admin | manager | staff | finance | client"
    }
  ]
}
```

---

### PATCH /auth/me

Update user profile (authenticated).

Request:

```json
{
  "firstName": "string",
  "lastName": "string"
}
```

---

### GET /auth/me/onboarding-spec

Get onboarding requirements for the current user.

Query: `agency_id`

---

### PATCH /auth/me/onboarding

Update onboarding status.

Request:

```json
{
  "agencies": {},
  "preferences": {}
}
```

---

## 2. Agencies

### POST /agencies

Create agency and assign caller as admin.

Request:

```json
{
  "name": "string",
  "default_currency": "string",
  "default_hourly_rate": 0
}
```

Rules:

* `default_currency` is immutable after creation

Response `201`:

```json
{
  "agency": {
    "id": "cuid",
    "name": "string",
    "default_currency": "string",
    "default_hourly_rate": 0,
    "created_at": "iso"
  }
}
```

---

### GET /agencies

List agencies current user belongs to.

---

### GET /agencies/{agencyId}

Get agency details.

Auth: agency member

---

### PATCH /agencies/{agencyId}

Update agency details.

Auth: admin

---

## 3. Agency Members

### GET /agencies/{agencyId}/members

List agency members.

Auth: admin, manager

Query: `limit`, `cursor`

---

### PATCH /agencies/{agencyId}/members/{userId}

Update member role, hourly rate, or weekly capacity.

Auth: admin

Request:

```json
{
  "role": "admin | manager | staff | finance | client",
  "hourlyRate": 0,
  "weeklyCapacityHours": 40
}
```

---

### DELETE /agencies/{agencyId}/members/{userId}

Remove member (soft delete).

Auth: admin
Rule: historical data MUST remain intact.

---

### POST /agencies/{agencyId}/invites

Invite user to agency.

Auth: admin

Request:

```json
{
  "email": "string",
  "role": "admin | manager | staff | finance | client"
}
```

---

### GET /agencies/{agencyId}/invites

List all invitations.

Auth: admin

Query: `status`, `limit`, `cursor`

---

### DELETE /agencies/{agencyId}/invites/{inviteId}

Cancel/delete invite.

Auth: admin

---

### POST /invites/{inviteId}/accept

Accept an invitation (authenticated).

---

### GET /invites

List pending invites for the authenticated user.

---

### GET /invites/{inviteId}

Get invite details (public — no auth required). Returns minimal data.

---

## 4. Clients

### POST /agencies/{agencyId}/clients

Create client.

Auth: admin

Request:

```json
{
  "name": "string",
  "contact_email": "string"
}
```

Rules:

* Client name MUST be unique per agency

---

### GET /agencies/{agencyId}/clients

List clients.

Auth: admin, manager, staff

Query: `status`, `search`, `limit`, `cursor`

---

### GET /agencies/{agencyId}/clients/{clientId}

Get client details.

---

### PATCH /agencies/{agencyId}/clients/{clientId}

Update client.

Auth: admin

---

### POST /agencies/{agencyId}/clients/{clientId}/invite-user

Invite a user as a client role member.

Auth: admin

---

## 5. Projects

### Project Model

```json
{
  "id": "cuid",
  "name": "string",
  "billing_model": "hourly | fixed_price | staff_augmentation | retainer_unlimited | retainer_hours_capped",
  "status": "active | on_hold | completed | cancelled",
  "visibility": "public | private",
  "qa_stage_enabled": true,
  "hours_visibility": "totals | by_resource | hidden",
  "hourly_rate": 0,
  "fixed_price": 0,
  "created_by_id": "uuid | null"
}
```

---

### POST /agencies/{agencyId}/projects

Create project.

Auth: admin, manager

Billing rules:

* `hourly` → `hourly_rate` required
* `fixed_price` → milestones drive progress
* `staff_augmentation` → staff assignments required
* `retainer_unlimited` → retainer config required
* `retainer_hours_capped` → retainer config + hour caps required

---

### GET /agencies/{agencyId}/projects

List projects (admin/manager/staff see all, filtered by membership for private projects)

Query: `status`, `client_id`, `search`, `limit`, `cursor`

---

### GET /agencies/{agencyId}/projects/{projectId}

Get project details.

---

### PATCH /agencies/{agencyId}/projects/{projectId}

Update project.

Auth: admin, staff (full edit) **or** project creator (price + archive only)

Creator-specific rules:
- Can update `hourly_rate`, `fixed_total_amount`
- Can set `status` to `CANCELLED` (archive) only
- Cannot modify other fields (name, dates, visibility, etc.)

---

### PUT /agencies/{agencyId}/projects/{projectId}/clients

Update project clients.

Auth: admin, manager

---

### GET /agencies/{agencyId}/projects/{projectId}/dashboard

Get project dashboard (progress, hours, milestones, recent activity).

---

### GET /agencies/{agencyId}/projects/{projectId}/members

List project members with roles.

---

### POST /agencies/{agencyId}/projects/{projectId}/members

Add project member.

Auth: admin, manager

Request:

```json
{
  "userId": "cuid",
  "role": "MANAGER | CONTRIBUTOR | VIEWER"
}
```

---

### PATCH /agencies/{agencyId}/projects/{projectId}/members/{userId}

Update project member role.

Auth: admin, manager

---

### DELETE /agencies/{agencyId}/projects/{projectId}/members/{userId}

Remove project member.

Auth: admin, manager

---

### POST /agencies/{agencyId}/projects/{projectId}/favorite

Toggle project as favorite for the current user.

---

### GET /agencies/{agencyId}/client/projects

List projects visible to client user.

Auth: client

---

## 6. Milestones

Milestones support hierarchical nesting via `parent_id`. Child milestones inherit context from their parent (e.g., a "Sprint 1" milestone under a "Q1 Release" milestone).

### POST /agencies/{agencyId}/projects/{projectId}/milestones

Request:

```json
{
  "title": "string",
  "sequence_order": 1,
  "status": "not_started | in_progress | completed",
  "due_date": "iso | null",
  "parent_id": "uuid | null"
}
```

`parent_id` — optional. Must reference an existing milestone in the same project. Cannot create circular references.

---

### GET /agencies/{agencyId}/projects/{projectId}/milestones

Response includes `parent_id` for each milestone.

---

### PATCH /agencies/{agencyId}/projects/{projectId}/milestones/{milestoneId}

Request supports `parent_id` (set to `null` to make top-level, or a valid milestone UUID to re-parent).

---

### DELETE /agencies/{agencyId}/projects/{projectId}/milestones/{milestoneId}

Deletes a milestone. Side effects:
- Tasks linked to this milestone are unlinked (`milestone_id` set to `null`)
- Child milestones are re-parented to the deleted milestone's parent (or become top-level if no parent)
- Activity logged as `milestone_deleted`

Response: `204 No Content`

---

## 7. Tasks

### Task Status

* `todo`
* `in_progress`
* `in_qa` (only if QA enabled on project)
* `done`

---

### POST /agencies/{agencyId}/projects/{projectId}/tasks

Request:

```json
{
  "title": "string",
  "description": "string",
  "milestone_id": "cuid | null",
  "assigned_user_id": "cuid | null",
  "parent_id": "cuid | null",
  "status": "todo | in_progress | in_qa | done",
  "priority": 0,
  "estimated_hours": 0,
  "start_date": "iso | null",
  "due_date": "iso | null"
}
```

Rules:

* Client users CANNOT modify tasks
* `parent_id` creates a subtask (one level of nesting)

---

### GET /agencies/{agencyId}/projects/{projectId}/tasks

Returns top-level tasks only by default, sorted by creation date (newest first).

Query params:

* `status` — filter by task status
* `assigned_user_id` — filter by assigned user
* `milestone_id` — filter by milestone
* `parent_id` — filter by parent task (returns subtasks of that parent)
* `top_level_only` — default `true`; set to `false` to include all tasks regardless of nesting

Ordering: `created_at` descending (newest first).

---

### GET /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}

---

### PATCH /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}

---

### DELETE /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}

---

### POST /agencies/{agencyId}/projects/{projectId}/tasks/import

Import tasks from a CSV file.

Request: multipart/form-data with `file` field (max 2MB).

---

### POST /agencies/{agencyId}/projects/{projectId}/tasks/bulk-delete

Delete multiple tasks.

Request:

```json
{
  "task_ids": ["cuid"]
}
```

---

### PATCH /agencies/{agencyId}/projects/{projectId}/tasks/bulk-update

Update multiple tasks at once.

Request:

```json
{
  "task_ids": ["cuid"],
  "milestone_id": "cuid | null",
  "assigned_user_id": "cuid | null",
  "status": "todo | in_progress | in_qa | done"
}
```

---

### 7b. Task Watchers

### GET /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/watchers

List users watching a task.

---

### POST /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/watchers

Add a watcher to a task.

Request:

```json
{
  "user_id": "cuid"
}
```

---

### DELETE /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/watchers/{userId}

Remove a watcher from a task.

---

### 7c. Task Dependencies

### GET /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/dependencies

List task dependencies.

---

### POST /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/dependencies

Add a dependency.

Request:

```json
{
  "depends_on_task_id": "cuid"
}
```

---

### DELETE /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/dependencies/{dependencyId}

Remove a dependency.

---

### 7d. Task Recurrence

### POST /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/recurrence

Set recurrence on a task.

Request:

```json
{
  "frequency": "daily | weekly | monthly",
  "interval": 1,
  "end_date": "iso | null",
  "max_occurrences": 0
}
```

---

### PATCH /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/recurrence

Update task recurrence settings.

---

### DELETE /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/recurrence

Remove recurrence from a task.

---

### GET /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}/occurrences

List occurrences of a recurring task.

Query: `limit`, `cursor`

---

### 7e. Task Labels

### GET /agencies/{agencyId}/task-labels

List task labels.

Query: `project_id` (optional — filter to project-specific labels)

---

### POST /agencies/{agencyId}/task-labels

Create a label.

Request:

```json
{
  "name": "string",
  "color": "#hex",
  "project_id": "cuid | null"
}
```

---

### PATCH /agencies/{agencyId}/task-labels/{labelId}

Update a label.

---

### DELETE /agencies/{agencyId}/task-labels/{labelId}

Delete a label.

---

### 7f. Task Templates

### POST /agencies/{agencyId}/task-templates

Create a task template.

Request:

```json
{
  "name": "string",
  "description": "string",
  "tasks": [{ "title": "string", "description": "string" }]
}
```

---

### GET /agencies/{agencyId}/task-templates

List task templates.

---

### GET /agencies/{agencyId}/task-templates/{templateId}

Get template details.

---

### PATCH /agencies/{agencyId}/task-templates/{templateId}

Update a template.

---

### DELETE /agencies/{agencyId}/task-templates/{templateId}

Delete a template.

---

### POST /agencies/{agencyId}/task-templates/{templateId}/apply/{projectId}

Apply a template to a project, creating tasks from the template.

Request:

```json
{
  "milestone_id": "cuid | null"
}
```

---

## 8. Time Tracking

### POST /agencies/{agencyId}/time-entries/timer/start

Rules:

* Only one active timer per user

Request:

```json
{
  "project_id": "cuid",
  "task_id": "cuid | null",
  "note": "string | null",
  "is_billable": true
}
```

---

### POST /agencies/{agencyId}/time-entries/timer/stop

Request:

```json
{
  "time_entry_id": "cuid"
}
```

---

### POST /agencies/{agencyId}/time-entries/timer/pause

Pause a running timer.

Request:

```json
{
  "time_entry_id": "cuid"
}
```

---

### POST /agencies/{agencyId}/time-entries/timer/resume

Resume a paused timer.

Request:

```json
{
  "time_entry_id": "cuid"
}
```

---

### POST /agencies/{agencyId}/time-entries

Manual entry.

Request:

```json
{
  "project_id": "cuid",
  "task_id": "cuid | null",
  "start_time": "iso",
  "end_time": "iso | null",
  "duration_minutes": 0,
  "note": "string | null",
  "is_billable": true,
  "tag_ids": ["cuid"],
  "user_id": "cuid | null"
}
```

Rules:
* `user_id` only allowed for admin/manager (track as another user)
* Either `end_time` or `duration_minutes` required

---

### GET /agencies/{agencyId}/time-entries

Query: `project_id`, `task_id`, `user_id`, `from_date`, `to_date`, `limit`, `cursor`

---

### GET /agencies/{agencyId}/time-entries/{timeEntryId}

---

### PATCH /agencies/{agencyId}/time-entries/{timeEntryId}

Update time entry.

---

### DELETE /agencies/{agencyId}/time-entries/{timeEntryId}

Soft-delete time entry.

---

### POST /agencies/{agencyId}/time-entries/{timeEntryId}/adjustments

Adjust time entry with audit trail.

Request:

```json
{
  "adjustedDurationMinutes": 0,
  "reason": "string"
}
```

---

### GET /agencies/{agencyId}/time-entries/team-summary

Team time entries summary.

Auth: admin, manager

Query: `from_date`, `to_date`, `project_id`, `user_id`

---

### GET /agencies/{agencyId}/time-entries/weekly-summary

Weekly summary grouped by project and day for timesheet grid.

Query: `week_start`, `user_id` (optional — admin can view others)

---

## 8b. Timesheets

### GET /agencies/{agencyId}/timesheets

Get timesheet status for a given week and user.

Auth: admin, manager (sees all), staff (sees own)

Query: `week_start`, `user_id`

---

### GET /agencies/{agencyId}/timesheets/pending

List timesheets pending approval.

Auth: admin, manager

---

### POST /agencies/{agencyId}/timesheets/submit

Submit timesheet for approval.

Request:

```json
{
  "weekStart": "iso"
}
```

Rules: Cannot submit if already submitted/approved.

---

### POST /agencies/{agencyId}/timesheets/{id}/recall

Recall a submitted timesheet back to draft.

Rules:
* Can only recall if no project approval is already APPROVED
* Deletes all project approval rows on successful recall

---

### POST /agencies/{agencyId}/timesheets/{id}/approve

Approve a submitted timesheet. Can target a single project or bulk approve all.

Auth: admin, manager, or project-level MANAGER

Request (optional):

```json
{
  "note": "string",
  "project_id": "cuid | null"
}
```

Rules:
* If `project_id` provided, approves only that project's approval row
* If omitted, approves all submitted project approval rows
* Response includes `project_approvals[]` and `approval_summary`

---

### POST /agencies/{agencyId}/timesheets/{id}/reject

Reject a submitted timesheet. Can target a single project or bulk reject all.

Auth: admin, manager, or project-level MANAGER

Request (optional):

```json
{
  "note": "string",
  "project_id": "cuid | null"
}
```

Rules:
* If `project_id` provided, rejects only that project's approval row
* If omitted, rejects all submitted project approval rows

---

### GET /agencies/{agencyId}/timesheets/settings

Get agency timesheet settings.

Auth: admin, manager

---

### PUT /agencies/{agencyId}/timesheets/settings

Update timesheet settings.

Auth: admin

Request:

```json
{
  "approval_required": true,
  "minimum_hours_per_day": 0,
  "weekend_visible": true
}
```

---

## 8c. Time Entry Tags

### GET /agencies/{agencyId}/time-entry-tags

List tags.

---

### POST /agencies/{agencyId}/time-entry-tags

Create tag.

Auth: admin, manager

Request:

```json
{
  "name": "string",
  "color": "#hex"
}
```

---

### PATCH /agencies/{agencyId}/time-entry-tags/{tagId}

Update tag.

Auth: admin, manager

---

### DELETE /agencies/{agencyId}/time-entry-tags/{tagId}

Delete tag.

Auth: admin, manager

---

## 9. Staff Augmentation

### GET /agencies/{agencyId}/projects/{projectId}/staff-assignment

Get staff assignment for a project.

---

### PUT /agencies/{agencyId}/projects/{projectId}/staff-assignment

Replace staff assignment for a project.

Request:

```json
{
  "assignments": [
    {
      "userId": "cuid",
      "billingType": "FIXED | HOURLY",
      "monthlyRetainerAmount": 0,
      "hourlyRate": 0,
      "startDate": "iso",
      "endDate": "iso | null"
    }
  ]
}
```

Rules:

* Multiple resources per project
* Each assignment can be FIXED (monthly retainer) or HOURLY (hourly rate)
* Composite unique: one assignment per user per project

---

## 9b. Work Categories

### GET /agencies/{agencyId}/work-categories

List work categories for the agency.

---

### POST /agencies/{agencyId}/work-categories

Create work category.

Auth: admin

Request:

```json
{
  "name": "string"
}
```

---

### DELETE /agencies/{agencyId}/work-categories/{categoryId}

Delete work category.

Auth: admin

---

## 10. Comments

### GET /agencies/{agencyId}/comments

Query: `entity_type`, `entity_id`, `limit`, `cursor`

---

### POST /agencies/{agencyId}/comments

Request:

```json
{
  "entity_type": "task | milestone",
  "entity_id": "cuid",
  "content": "string",
  "parent_id": "cuid | null"
}
```

---

### PATCH /agencies/{agencyId}/comments/{commentId}

Update comment content.

Request:

```json
{
  "content": "string"
}
```

---

### DELETE /agencies/{agencyId}/comments/{commentId}

Delete a comment.

---

## 11. Concerns

### GET /agencies/{agencyId}/projects/{projectId}/concerns

List project concerns.

---

### POST /agencies/{agencyId}/projects/{projectId}/concerns

Create concern.

Request:

```json
{
  "title": "string",
  "description": "string"
}
```

---

### PATCH /agencies/{agencyId}/projects/{projectId}/concerns/{id}

Update concern status.

Auth: admin, manager, staff

Request:

```json
{
  "status": "open | acknowledged | resolved",
  "resolution": "string"
}
```

---

## 12. Billing & Invoices

### GET /agencies/{agencyId}/billing/invoice-preview

Preview invoice before generation.

Query: `client_id`, `period` (YYYY-MM)

---

### POST /agencies/{agencyId}/invoices

Generate invoice.

Auth: admin, finance

---

### GET /agencies/{agencyId}/invoices

List invoices.

Query: `client_id`, `status`, `period`, `limit`, `cursor`

---

### GET /agencies/{agencyId}/invoices/{invoiceId}

Get invoice details with line items.

---

### GET /agencies/{agencyId}/invoices/{invoiceId}/pdf

Download invoice PDF.

---

### POST /agencies/{agencyId}/invoices/{invoiceId}/void

Void invoice with reason.

Auth: admin, finance

Request:

```json
{
  "reason": "string"
}
```

---

### POST /agencies/{agencyId}/invoices/{invoiceId}/mark-paid

Mark an invoice as paid.

Auth: admin, finance

---

## 13. AI (Read-Only)

### POST /agencies/{agencyId}/ai/project-summary

---

### POST /agencies/{agencyId}/ai/utilization

---

### POST /agencies/{agencyId}/ai/query

Rules:

* Explicitly triggered
* Rate limited (10 req/min per user)
* No side effects

---

## 14. Real-Time (WebSocket)

### WS /v1/ws

Authentication: JWT token in handshake query or auth header.

Rooms:

* `agency:{agencyId}` — agency-wide broadcasts
* `project:{projectId}` — project-specific updates
* `user:{userId}` — personal notifications

Events:

* `task.updated` — task data changed
* `timer.started` / `timer.stopped` — timer state changes
* `activity.created` — new activity log entry
* `notification.created` — new notification for user

Delivery SLA:

* ≤ 2 seconds

---

## 15. Activity & Notifications

### GET /agencies/{agencyId}/activity

Cursor-paginated activity feed. 20 action types across 8 entity types.

Query: `cursor`, `limit`, `entity_type`, `entity_id`, `project_id`, `actor_id`

---

### GET /agencies/{agencyId}/notifications

Cursor-paginated notifications for the authenticated user.

Query: `cursor`, `limit`

---

### GET /agencies/{agencyId}/notifications/unread-count

Returns `{ count: number }`.

---

### PATCH /agencies/{agencyId}/notifications/{id}/read

Mark a single notification as read.

---

### POST /agencies/{agencyId}/notifications/mark-all-read

Mark all notifications as read for the authenticated user.

---

### GET /agencies/{agencyId}/my-tasks

Cross-project tasks assigned to the current user.

Query: `status` (comma-separated), `sort` (due_date | priority | created_at), `cursor`, `limit`

Response includes `project_id` and `project_name` per task item.

---

### GET /agencies/{agencyId}/notification-preferences

Get notification preferences for the current user.

---

### PATCH /agencies/{agencyId}/notification-preferences

Update notification preferences.

Request:

```json
{
  "type": "task_assigned | mentioned_in_comment | ...",
  "in_app": true,
  "email": false
}
```

---

## 16. Analytics

### GET /agencies/{agencyId}/analytics

General analytics overview.

Query: `period` (optional, defaults to `this_month`)

Valid periods: `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`

Response:

```json
{
  "period": { "label": "string", "start": "ISO8601", "end": "ISO8601" },
  "revenue": {
    "monthly_data": [{ "month": "YYYY-MM", "label": "string", "amount": 0 }],
    "total_revenue": 0,
    "mom_growth": null
  },
  "utilization": {
    "members": [{ "user_id": "cuid", "user_name": "string", "hours": 0 }],
    "total_hours": 0,
    "avg_hours_per_member": 0
  },
  "project_health": {
    "by_status": [{ "status": "string", "count": 0 }],
    "total_projects": 0,
    "milestone_completion": { "total": 0, "completed": 0, "rate": 0 }
  },
  "client_revenue": [{ "client_id": "cuid", "client_name": "string", "total_revenue": 0 }]
}
```

---

### GET /agencies/{agencyId}/analytics/clients

Client-specific analytics.

Auth: admin, finance

Query: `period`

---

### GET /agencies/{agencyId}/analytics/projects

Project-specific analytics.

Auth: admin, manager

Query: `period`

---

### GET /agencies/{agencyId}/analytics/financial

Financial analytics.

Auth: admin, finance

Query: `period`

---

### GET /agencies/{agencyId}/analytics/utilization

Team utilization analytics.

Auth: admin, manager

Query: `period`

---

### GET /agencies/{agencyId}/analytics/personal

Personal analytics for the current user.

Auth: admin, manager, staff

Query: `period`

---

## 17. File Attachments

### POST /agencies/{agencyId}/attachments

Upload a file. Multipart/form-data with fields: `file`, `entity_type`, `entity_id`.

Entity types: `project`, `task`, `comment`

Allowed MIME types: image/jpeg, image/png, image/gif, image/webp, application/pdf, docx, xlsx, text/csv, text/plain.

Max file size: 10MB.

---

### POST /agencies/{agencyId}/attachments/inline-image

Upload an inline image for rich text editors. Multipart/form-data with fields: `file`, `entity_type`, `entity_id`.

---

### GET /agencies/{agencyId}/attachments

List attachments for an entity.

Query: `entity_type`, `entity_id` (both required)

---

### GET /agencies/{agencyId}/attachments/{id}/download-url

Returns a presigned download URL (15-minute expiry).

---

### DELETE /agencies/{agencyId}/attachments/{id}

Delete file from storage and database.

---

## 18. Wiki

Dual-scope wiki: `projectId=null` for agency-wide SOPs, `projectId=uuid` for project docs. Pages support hierarchy (parent/child), rich text content (Tiptap JSON), revision history, full-text search, and image uploads via attachments.

**Access control:** Agency members can access global wiki. Project wiki requires project membership (or admin bypass). Clients see published pages only. Delete restricted to admin, manager, or page creator.

### GET /agencies/{agencyId}/wiki

List global wiki pages as a nested tree (up to 3 levels).

**Query params:** `include_drafts` (boolean, staff only)

**Response:** `{ pages: WikiPage[] }` — each page includes `children: WikiPage[]`

### POST /agencies/{agencyId}/wiki

Create a global wiki page. **201 Created.**

**Body:**
```json
{ "title": "...", "slug": "...", "content": {}, "parent_id?": "uuid", "sort_order?": 0, "is_published?": true, "is_template?": false }
```

### GET /agencies/{agencyId}/wiki/search

Full-text search across wiki pages using PostgreSQL tsvector.

**Query params:** `q` (required, min 2 chars), `project_id` (optional)

**Response:** `{ results: [{ id, title, slug, rank, headline, ... }] }` — headline contains `<mark>` highlights

### GET /agencies/{agencyId}/wiki/{slug}

Get a single wiki page by slug.

### PATCH /agencies/{agencyId}/wiki/{slug}

Update a wiki page. Creates a revision snapshot before applying content changes.

**Body:**
```json
{ "title?": "...", "slug?": "...", "content?": {}, "parent_id?": "uuid|null", "sort_order?": 0, "is_published?": true }
```

### DELETE /agencies/{agencyId}/wiki/{slug}

Soft-delete a wiki page and all its children recursively. Restricted to admin, manager, or page creator.

### POST /agencies/{agencyId}/wiki/{pageId}/reorder

Update a page's position in the tree.

**Body:**
```json
{ "parent_id?": "uuid|null", "sort_order": 0 }
```

### GET /agencies/{agencyId}/wiki/{pageId}/revisions

List revision history for a page, ordered by creation date descending.

**Response:** `{ revisions: [{ id, content, edited_by: { id, first_name, last_name }, created_at }] }`

### Project-Scoped Wiki

All the same endpoints are available under the project scope:

- `GET /agencies/{agencyId}/projects/{projectId}/wiki`
- `POST /agencies/{agencyId}/projects/{projectId}/wiki`
- `GET /agencies/{agencyId}/projects/{projectId}/wiki/{slug}`
- `PATCH /agencies/{agencyId}/projects/{projectId}/wiki/{slug}`
- `DELETE /agencies/{agencyId}/projects/{projectId}/wiki/{slug}`

Reorder and revisions use the global path with `pageId`.

---

## 19. Project Categories

### GET /agencies/{agencyId}/project-categories

List project categories.

---

### POST /agencies/{agencyId}/project-categories

Create a category.

Request:

```json
{
  "name": "string",
  "color": "#hex",
  "sort_order": 0
}
```

---

### PATCH /agencies/{agencyId}/project-categories/{categoryId}

Update a category.

---

### DELETE /agencies/{agencyId}/project-categories/{categoryId}

Delete a category.

---

### PUT /agencies/{agencyId}/project-categories/reorder

Reorder categories.

Request:

```json
{
  "items": [{ "id": "cuid", "sort_order": 0 }]
}
```

---

## 20. Status Definitions

Customizable status definitions for projects and tasks. Task statuses can be overridden per-project.

### 20a. Project Statuses

### GET /agencies/{agencyId}/project-statuses

List project status definitions.

---

### POST /agencies/{agencyId}/project-statuses

Create a project status.

Request:

```json
{
  "name": "string",
  "color": "#hex"
}
```

---

### PATCH /agencies/{agencyId}/project-statuses/{statusId}

Update a project status.

---

### DELETE /agencies/{agencyId}/project-statuses/{statusId}

Delete a project status. Requires `replacement_id` in body to reassign existing projects.

---

### PUT /agencies/{agencyId}/project-statuses/reorder

Reorder project statuses.

Request:

```json
{
  "items": [{ "id": "cuid", "sort_order": 0 }]
}
```

---

### 20b. Task Statuses (Agency Defaults)

### GET /agencies/{agencyId}/task-statuses

List agency-level task status definitions.

---

### POST /agencies/{agencyId}/task-statuses

Create a task status.

---

### PATCH /agencies/{agencyId}/task-statuses/{statusId}

Update a task status.

---

### DELETE /agencies/{agencyId}/task-statuses/{statusId}

Delete a task status. Requires `replacement_id` to reassign tasks.

---

### PUT /agencies/{agencyId}/task-statuses/reorder

Reorder task statuses.

---

### 20c. Task Statuses (Project Overrides)

### GET /agencies/{agencyId}/projects/{projectId}/task-statuses

List task statuses for a specific project (overrides agency defaults).

---

### POST /agencies/{agencyId}/projects/{projectId}/task-statuses

Create a project-specific task status.

---

### PATCH /agencies/{agencyId}/projects/{projectId}/task-statuses/{statusId}

Update a project task status.

---

### DELETE /agencies/{agencyId}/projects/{projectId}/task-statuses/{statusId}

Delete a project task status. Requires `replacement_id`.

---

### PUT /agencies/{agencyId}/projects/{projectId}/task-statuses/reorder

Reorder project task statuses.

---

### POST /agencies/{agencyId}/projects/{projectId}/task-statuses/reset-to-defaults

Reset project task statuses back to agency defaults.

---

## 21. Super Admin

Separate authentication and admin panel for platform management.

### POST /super-admin/auth/login

Super admin login.

Request:

```json
{
  "email": "string",
  "password": "string"
}
```

---

### GET /super-admin/auth/me

Get super admin profile.

---

### POST /super-admin/auth/logout

Super admin logout.

---

### GET /super-admin/dashboard/stats

Platform-wide statistics.

---

### GET /super-admin/dashboard/recent-signups

Recent user signups.

Query: `limit` (1–50, default 10)

---

### GET /super-admin/dashboard/agencies-overview

Agencies overview with metrics.

---

### GET /super-admin/users

List all users.

Query: `search`, `limit`, `offset`

---

### GET /super-admin/users/{id}

Get user details.

---

### GET /super-admin/agencies

List all agencies.

Query: `search`, `status`, `limit`, `offset`

---

### GET /super-admin/agencies/{id}

Get agency details.

---

### PATCH /super-admin/agencies/{id}/status

Update agency status.

Request:

```json
{
  "status": "active | suspended | inactive"
}
```

---

### PATCH /super-admin/agencies/{id}/subscription

Update agency subscription.

Request:

```json
{
  "plan_id": "cuid",
  "billing_period": "monthly | yearly",
  "auto_renew": true
}
```

---

### GET /super-admin/plans

List all subscription plans.

---

### POST /super-admin/plans

Create a plan.

---

### PATCH /super-admin/plans/{id}

Update a plan.

---

### DELETE /super-admin/plans/{id}

Delete a plan.

---

## 22. Out of Scope

* Payments (payment processing/collection)
* CRM
* Mobile apps
* Custom workflows
* AI task execution (AI is read-only)

---

## 23. Change Control

This API contract reflects the implemented production system as of 2026-04-02.
New endpoints follow the same conventions. Breaking changes require API versioning.
