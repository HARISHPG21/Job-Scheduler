# Design Decisions & Trade-offs

This document outlines the major architectural and design trade-offs made during the implementation of the Distributed Job Scheduler.

---

## 1. Database Selection: Relational SQLite/Prisma vs. Redis/NoSQL

### Context
Distributed schedulers are traditionally built on top of high-throughput key-value stores (like Redis via BullMQ) or message brokers (like RabbitMQ).

### Decision
We chose **SQLite with Prisma ORM** (relational SQL) for storing queues, jobs, logs, and heartbeats.

### Trade-offs & Rationale
- **ACID Transactions**: Relational databases support robust, multi-row ACID transactions. Claiming a job requires verifying queue limits, paused states, parent-job dependency completions, and status changes in a single action. Relational database locks ensure this remains completely atomic, preventing double-claiming under concurrent worker spikes.
- **Relational Integrity**: Having built-in foreign key constraints (`Organization` -> `Project` -> `Queue` -> `Job`) makes multi-tenant data isolation and clean cascading deletes trivial.
- **Local Portability**: SQLite is a self-contained, serverless database engine that writes to a local file (`dev.db`). It runs on the user's host machine out-of-the-box without requiring Docker containers or external server services (like PostgreSQL or Redis).
- **WAL Mode (Write-Ahead Logging)**: We enabled WAL mode to allow multiple concurrent read transactions to execute while a write operation is committing, overcoming SQLite's traditional file-locking constraints.

---

## 2. Decoupled HTTP Polling vs. Push-Based (gRPC/WebSockets) for Workers

### Context
Workers need to claim jobs and report back. We had to decide whether to push tasks to workers via persistent connections or have workers poll for work.

### Decision
We implemented a **decoupled HTTP Polling model** with exponential backoff on empty queues.

### Trade-offs & Rationale
- **Network Resilience**: Workers in distributed environments frequently lose connection, crash, or experience network drops. With stateless HTTP polling, a worker connection drop doesn't break socket states on the server. If a worker goes offline, the server's timeout janitor reclaims the job automatically.
- **Firewall & Proxy friendly**: HTTP polling runs over port 80/443, making it compatible with corporate firewalls and reverse proxies without requiring custom TCP/WebSocket configuration.
- **Backoff to Prevent Hammering**: If a worker receives a `204 No Content` response (empty queue), it increases its polling interval (backoff) up to 10 seconds. When a new job is successfully claimed, the interval instantly resets to 1 second. This reduces HTTP chatter on idle pipelines.

---

## 3. Real-Time Dashboard Updates: WebSockets vs. HTTP Polling

### Context
The dashboard needs live statistics (throughput counts, online workers, active running counts).

### Decision
We chose a **hybrid model**: **WebSockets** push live telemetry every 2 seconds for a responsive feel, with **HTTP Polling** as a fallback.

### Trade-offs & Rationale
- **Performance Optimization**: Instead of having the client poll the metrics API repeatedly (which queries the SQLite database on every click), the WebSocket server groups active dashboard connections by `organizationId`. It performs a single database aggregation query per active organization and broadcasts the payload to all organization members simultaneously. This keeps database load very low.
- **Robust Fallback**: If the WebSocket connection is blocked, the frontend dashboard seamlessly falls back to standard HTTP polling, maintaining dashboard usability.

---

## 4. Worker Crash Recovery (Janitor Loop)

### Context
If a worker process is terminated (e.g. `kill -9` or server power loss) while running a job, that job could get stuck in `RUNNING` status forever.

### Decision
We implemented a **Worker Recovery Janitor** loop running every 5 seconds on the server.

### Trade-offs & Rationale
- **Dead Worker Isolation**: Workers send heartbeats containing CPU/RAM usage every 3 seconds. The Janitor scans for active workers that haven't sent heartbeats in 15 seconds.
- **Decoupled Recovery**: Instead of waiting for a worker to restart and report its state, the server identifies the worker timeout, marks the worker as `INACTIVE`, and automatically schedules the orphan jobs for retry (incrementing retry counts and calculating backoffs) or drops them into the Dead Letter Queue.

---

## 5. Sliding Window Rate Limiting: SQL-Based log queries vs. In-Memory Token Bucket

### Context
Queue-level rate limiting is critical to prevent API exhaustion (e.g. hitting third-party SaaS rate limits). Schedulers typically use an in-memory database like Redis with a Token Bucket or Sliding Window Log algorithm.

### Decision
We implemented a **Sliding Window log rate limiter** using native SQL aggregates on the `JobExecution` table.

### Trade-offs & Rationale
- **Zero Extra Infrastructure**: By counting execution records in the database (`startedAt >= now - windowSeconds`), we implement perfect sliding-window rate limiting without adding Redis or Memcached dependencies to the project.
- **Accuracy**: Unlike Fixed Window counters (which can experience double the traffic limit at window boundaries), the Sliding Window log counts started job executions with microsecond precision, preventing rate limit breaches under high-concurrency worker claims.
- **Transactional Consistency**: The rate limit check executes inside the same atomic database transaction (`prisma.$transaction`) that claims the job. This ensures that even with multiple worker processes polling the server concurrently, the rate limit is enforced with absolute consistency.

---

## 6. Job-Level Priority Queuing: Multi-Field Database Ordering vs Heap Queues

### Context
Jobs inside a queue need to be processed in order. Standard queues use FIFO (First-In, First-Out), but system tasks often require urgent jobs to jump to the front of the queue. Schedulers typically maintain separate priority queues (e.g. using Min-Heaps or Redis sorted sets).

### Decision
We implemented **Job-Level Priority Queuing** using multi-field sorting (`priority DESC, createdAt ASC`) in our relational query claim transaction.

### Trade-offs & Rationale
- **Dynamic Re-Prioritization**: Since jobs are rows in a relational database, changing a job's priority or scheduling order is a simple database update. Heap queues or message broker indexes (like RabbitMQ) do not support updating priorities in-flight once queued.
- **Combined Sorting Engine**: The database query handles complex composite ordering. In a single index scan, it retrieves the highest priority jobs first, falling back to FIFO (oldest creation date first) for jobs sharing the same priority score.
- **Resource Efficiency**: Avoids maintaining separate priority queues in memory. Prisma translates the composite ordering criteria into structured SQL queries that SQLite executes efficiently utilizing B-tree database indexes.

---

## 7. Production Distributed Architecture vs. In-Process Mock Scheduler Designs

### Context
When building scheduler assignments, common developer shortcuts include combining the worker loop directly in the web server process or building a mock database wrapper. However, real-world distributed execution engines require strict decoupling.

### Design Matrix Comparison

| Architecture Dimension | Monolithic / Mock Designs | Our Decoupled Distributed Design |
| :--- | :--- | :--- |
| **Worker Scaling** | Workers run inline using `setInterval` threads inside the web API process, making horizontal scaling impossible. | **Decoupled Monorepo**. Worker runs as a stateless, independent daemon that scales horizontally across remote hosts, connecting via REST. |
| **Claim Consistency** | Lacks database transaction isolation, causing double-execution race conditions under concurrent worker polling. | **Atomic CLAIM Transactions** (`prisma.$transaction`) simulating SELECT FOR UPDATE locks to ensure zero duplicate executions. |
| **Security & Tenancy** | Dummy Bearer auth bypasses without validation or encryption. | **JWT Authentication** with password hashing (`bcryptjs`) enforcing strict tenant segregation across Organizations and Projects. |
| **Verification Rigor** | Simple syntax checks and compilation builds only. | **Jest E2E Integration Suite** (9 automated test cases) executed inside isolated sandboxed test databases. |

---

## 8. Distributed Queue Sharding: Virtual Shards vs. Physical Sharding

### Context
Under high concurrent loads (e.g. hundreds of workers polling a single queue table), a relational database table can experience serious lock contention. Every worker query attempts to read, write, and lock rows in the same table, slowing down processing throughput.

### Decision
We implemented **Virtual Queue Sharding** by partitioning queues into `N` virtual shards (`shardsCount`) with deterministic worker-shard mapping and work-stealing failovers.

### Trade-offs & Rationale
- **Deterministic Load Balancing**: Workers hash their unique worker ID modulo the queue's `shardsCount` (`hash(workerId) % shardsCount`) to determine their assigned shard. A worker only queries its assigned shard during initial claims, spreading out database locks and eliminating lock contention completely in multi-worker scenarios.
- **Work Stealing Failover**: If a worker's primary assigned shard is empty, it falls back to poll other shards in the queue. This prevents workers from sitting idle when some shards are empty and others are backlogged, maintaining 100% worker utilization.
- **No Clustering Overhead**: By using virtual partition fields (`shardId`) inside a single database instance rather than physical shards (separate servers), we implement sharding scaling models without the high costs, latency, or network complexity of multi-server setups.
