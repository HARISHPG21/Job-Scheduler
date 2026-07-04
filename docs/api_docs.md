# API Documentation

The Distributed Job Scheduler backend exposes clean, structured REST endpoints. All user-facing APIs require authentication headers, while worker-facing APIs are open to facilitate programmatic communication.

## Headers & Authentication

All authenticated endpoints require the JWT token in the request header:
```http
Authorization: Bearer <JWT_TOKEN>
```

---

## Authentication Endpoints

### 1. Register Account
- **Endpoint**: `POST /api/auth/register`
- **Body**:
  ```json
  {
    "email": "admin@acme.com",
    "password": "password123",
    "name": "P.G.Harish",
    "organizationName": "Job Scheduler"
  }
  ```
- **Response** (201 Created):
  ```json
  {
    "token": "eyJhbG...",
    "user": { "id": "uuid-1", "email": "admin@acme.com", "name": "P.G.Harish", "role": "ADMIN" },
    "organization": { "id": "uuid-2", "name": "Job Scheduler" }
  }
  ```

### 2. Login
- **Endpoint**: `POST /api/auth/login`
- **Body**:
  ```json
  {
    "email": "admin@acme.com",
    "password": "password123"
  }
  ```
- **Response** (200 OK):
  Same token payload as registration.

---

## Projects & Queues APIs

### 1. List Projects
- **Endpoint**: `GET /api/projects`
- **Response**: Array of Project objects with queue counts.

### 2. Create Project
- **Endpoint**: `POST /api/projects`
- **Body**: `{ "name": "Billing Operations" }`

### 3. List Queues
- **Endpoint**: `GET /api/queues`
- **Response**: Array of Queue objects including current running job count and retry policy.

### 4. Create Queue
- **Endpoint**: `POST /api/queues`
- **Body**:
  ```json
  {
    "name": "critical-notifications",
    "projectId": "project-uuid",
    "priority": 10,
    "concurrencyLimit": 8,
    "retryPolicyId": "policy-uuid",
    "rateLimitMax": 10,
    "rateLimitWindow": 60,
    "shardsCount": 3
  }
  ```

### 5. Update Queue Settings (Pause/Resume, Concurrency)
- **Endpoint**: `PUT /api/queues/:id`
- **Body**:
  ```json
  {
    "priority": 8,
    "concurrencyLimit": 12,
    "isPaused": true,
    "retryPolicyId": null,
    "rateLimitMax": 5,
    "rateLimitWindow": 30
  }
  ```

---

## Jobs APIs

### 1. Create Job (Immediate / Delayed)
- **Endpoint**: `POST /api/jobs`
- **Body**:
  ```json
  {
    "queueId": "queue-uuid",
    "payload": "{\"userId\": 998}",
    "jobType": "email",
    "delaySecs": 30,
    "parentJobId": null,
    "priority": 10
  }
  ```
- **Response** (201 Created): Returns the created Job object in `SCHEDULED` or `QUEUED` status.

### 2. Create Recurring Cron Job
- **Endpoint**: `POST /api/jobs`
- **Body**:
  ```json
  {
    "queueId": "queue-uuid",
    "payload": "{\"vacuum\": true}",
    "jobType": "db_maintenance",
    "cronExpression": "0 0 * * *",
    "cronName": "Daily Database Vacuum"
  }
  ```
- **Response** (201 Created): Returns the `ScheduledJob` config object.

### 3. Create Batch of Jobs
- **Endpoint**: `POST /api/jobs/batch`
- **Body**:
  ```json
  {
    "queueId": "queue-uuid",
    "jobType": "email",
    "jobs": [
      { "payload": "{\"userId\": 1}" },
      { "payload": "{\"userId\": 2}" }
    ]
  }
  ```

### 4. List Jobs (With Filters & Pagination)
- **Endpoint**: `GET /api/jobs`
- **Query Params**:
  - `page`: Page index (default: 1)
  - `limit`: Page count limit (default: 20)
  - `status`: Filter by status (`QUEUED`, `RUNNING`, etc.)
  - `queueId`: Filter by Queue
  - `search`: Match string inside payload field
- **Response**:
  ```json
  {
    "jobs": [...],
    "pagination": { "total": 100, "page": 1, "limit": 20, "totalPages": 5 }
  }
  ```

### 5. View Job Details & Execution History
- **Endpoint**: `GET /api/jobs/:id`
- **Response**: Job details, nested array of `executions` attempts, and sequential execution progress `logs`.

### 6. Cancel Pending / Running Job
- **Endpoint**: `POST /api/jobs/:id/cancel`

---

## Worker APIs (Programmatic client endpoints)

### 1. Register Worker Node
- **Endpoint**: `POST /api/workers/register`
- **Body**: `{ "name": "worker-node-1", "host": "192.168.1.55" }`

### 2. Heartbeat Tick
- **Endpoint**: `POST /api/workers/heartbeat`
- **Body**:
  ```json
  {
    "workerId": "worker-node-1",
    "cpuUsage": 12.5,
    "ramUsage": 68.2,
    "activeJobsCount": 2
  }
  ```

### 3. Claim Job (Atomic Transaction)
- **Endpoint**: `POST /api/workers/claim`
- **Body**: `{ "workerId": "worker-node-1" }`
- **Response**:
  - `200 OK`: `{ "job": {...}, "executionId": "exec-uuid" }`
  - `204 No Content`: If no eligible jobs are available or queue limits are hit.

### 4. Complete Execution
- **Endpoint**: `POST /api/workers/complete`
- **Body**: `{ "jobId": "job-uuid", "workerId": "worker-node-1", "output": "Synced 142 records." }`

### 5. Fail Execution
- **Endpoint**: `POST /api/workers/fail`
- **Body**: `{ "jobId": "job-uuid", "workerId": "worker-node-1", "errorMessage": "Connection Timeout" }`

### 6. Stream Log Row
- **Endpoint**: `POST /api/workers/jobs/:jobId/log`
- **Body**: `{ "level": "INFO", "message": "Downloading database table metadata..." }`

---

## Dead Letter Queue (DLQ) APIs

### 1. List DLQ Entries
- **Endpoint**: `GET /api/jobs/dlq`

### 2. Retry DLQ Entry
- **Endpoint**: `POST /api/jobs/dlq/:id/retry`
- **Description**: Re-queues the failed job and deletes the DLQ quarantine record.

### 3. Delete DLQ Entry
- **Endpoint**: `DELETE /api/jobs/dlq/:id`

### 4. Bulk Retry All DLQ
- **Endpoint**: `POST /api/jobs/dlq/retry-all`

### 5. Bulk Purge DLQ
- **Endpoint**: `POST /api/jobs/dlq/purge`
