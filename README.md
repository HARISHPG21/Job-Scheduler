# Job Scheduler

A production-inspired, highly reliable, multi-tenant distributed job scheduling platform capable of executing asynchronous background tasks concurrently across multiple worker nodes.

## Core Features Implemented

1. **Multi-Tenancy & Auth**: Secure registration and JWT-based authentication. Users belong to Organizations, which isolate Projects, Queues, Jobs, and Logs.
2. **Flexible Job Pipelines**: Exposes REST APIs to submit:
   - **Immediate Jobs**: Queued immediately.
   - **Delayed Jobs**: Scheduled to run after a specific duration offset.
   - **Batch Jobs**: Spawns multiple jobs concurrently in a single request.
   - **Cron Recurring Jobs**: Evaluated automatically via a cron-parsing scheduler tick loop.
3. **Workflow Dependencies**: Jobs can have a `parentJobId` dependency; a job is only eligible for claim and execution once its parent has successfully reached the `COMPLETED` state.
4. **Queue Configurations**: Configurable queue priority metrics (highest claimed first), concurrency execution limits, and pause/resume states.
5. **Configurable Retry Backoffs**: Leverages retry policies supporting **Fixed Delay**, **Linear Backoff**, and **Exponential Backoff** calculations.
6. **Dead Letter Queue (DLQ)**: Quarantines permanent job failures (when max retry attempts are exceeded) with failure context, providing bulk retry/purge capabilities.
7. **Telemetry and Heartbeats**: Scale workers horizontally. Workers report system load (CPU/RAM metrics) every 3 seconds, and a server recovery janitor automatically reclaims jobs from offline workers.
8. **Real-time Web Dashboard**: Designed with glassmorphism panels andOutfit typography. Subscribes to live organization metrics over WebSockets, displaying job statuses, worker telemetries, logs terminal, and throughput charts.
9. **Sliding Window Rate Limiting**: Configure optional queue-level rate limits (e.g., max 10 jobs per 60 seconds) to prevent external API exhaustion. Employs a zero-dependency sliding window count query inside atomic claiming transactions.
10. **Job-Level Priority Queuing**: Configure job-level priority scores (1-10) to bypass default FIFO queue ordering under concurrent loads. Exposes priority metrics next to task logs.
11. **Distributed Queue Sharding**: Optionally shard high-throughput queues into multiple virtual shards. Distributes database locks deterministically based on worker ID hashes, preventing single-table database lock bottlenecks during massive polling events.

---

## Technical Stack
- **Monorepo**: npm workspaces
- **Backend Server**: Node.js, Express, TypeScript, WebSockets (`ws`)
- **Database**: SQLite with Prisma ORM
- **Worker Node**: Standalone lightweight TypeScript client
- **Frontend Dashboard**: React, Vite, Vanilla CSS, Lucide icons
- **Testing**: Jest, Supertest, ts-jest

---

## Detailed Project Documentation

- [System Architecture](file:///d:/RA2311026020172%20-%20P.G.Harish/docs/architecture.md)
- [Database Schema Design & Indexes](file:///d:/RA2311026020172%20-%20P.G.Harish/docs/db_design.md)
- [REST API Endpoint References](file:///d:/RA2311026020172%20-%20P.G.Harish/docs/api_docs.md)
- [Design Decisions & Trade-offs](file:///d:/RA2311026020172%20-%20P.G.Harish/docs/design_decisions.md)

---

## Setup & Running Locally

Follow these sequential steps to boot the entire platform:

### 1. Install Workspace Dependencies
Open your terminal at the project root and install all node packages:
```bash
npm install
```

### 2. Initialize Database & Run Migrations
Generate the SQLite database file and compile the Prisma client:
```bash
npm run db:migrate
```

### 3. Seed Database Records
Insert the default multi-tenant organization, projects, retry policies, queues, and admin credentials:
```bash
npm run db:seed
```

### 4. Boot the Platform (Monorepo dev scripts)
Start the Backend API Server, a Worker Client, and the React Web Dashboard concurrently with a single command:
```bash
npm run dev
```
- **Web Dashboard**: Access it at [http://localhost:3000](http://localhost:3000)
- **API Server**: Runs on [http://localhost:5000](http://localhost:5000)

### 5. Sign In Credentials
Log in to the dashboard using the seeded sandbox account:
- **Email**: `admin@acme.com`
- **Password**: `password123`

---

## Scaling Workers Concurrently

To demonstrate the distributed nature of the scheduler, you can spin up additional worker nodes in separate terminals:

```bash
# Start Worker B (with custom name and concurrency limit of 5)
npx ts-node worker/src/index.ts --name worker-B --concurrency 5

# Start Worker C (running on a different thread count)
npx ts-node worker/src/index.ts --name worker-C --concurrency 2
```
In the **Worker Nodes Monitor** tab on your web dashboard, you will instantly see these workers register, stream their CPU/RAM load metrics, and divide queue claims concurrently.

---

## Running Automated Tests

We have implemented E2E integration tests covering authentication, queue settings, job life transitions, atomic claiming under concurrency, and exponential backoff strategies.

Execute tests using Jest:
```bash
npm run test
```
All tests are executed on a clean SQLite database context to guarantee test case isolation.
