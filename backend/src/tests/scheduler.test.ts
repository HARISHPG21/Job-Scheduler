import fs from 'fs';
import path from 'path';

// Isolate test database from development database dev.db
const dbDir = path.resolve(__dirname, '../../../backend/prisma');
const devDbPath = path.join(dbDir, 'dev.db');
const testDbPath = path.join(dbDir, 'test.db');

if (fs.existsSync(devDbPath)) {
  fs.copyFileSync(devDbPath, testDbPath);
}

process.env.DATABASE_URL = 'file:./test.db';

import request from 'supertest';
import { server, stopMetricsInterval } from '../server';
import prisma from '../prisma';
import { stopSchedulerServices } from '../services/scheduler';

// Ensure background loops don't keep process alive
afterAll(async () => {
  stopSchedulerServices();
  stopMetricsInterval();
  await prisma.$disconnect();
  // Close HTTP server
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Clean up test database files
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const walPath = `${testDbPath}-wal`;
    const shmPath = `${testDbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  } catch (err) {
    // Ignore transient cleanup errors
  }
});

describe('Distributed Job Scheduler E2E Integration Tests', () => {
  let token: string;
  let organizationId: string;
  let projectId: string;
  let queueId: string;
  let policyId: string;

  // Clean database before each test
  beforeEach(async () => {
    await prisma.deadLetterJob.deleteMany();
    await prisma.jobLog.deleteMany();
    await prisma.jobExecution.deleteMany();
    await prisma.job.deleteMany();
    await prisma.scheduledJob.deleteMany();
    await prisma.queue.deleteMany();
    await prisma.retryPolicy.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.workerHeartbeat.deleteMany();
    await prisma.worker.deleteMany();

    // Register a fresh organization & user to get JWT token
    const res = await request(server)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test Tester',
        organizationName: 'Test Org',
      });

    token = res.body.token;
    organizationId = res.body.organization.id;

    // Get the seeded project & queue
    const project = await prisma.project.findFirst({
      where: { organizationId },
    });
    projectId = project!.id;

    const queue = await prisma.queue.findFirst({
      where: { projectId },
    });
    queueId = queue!.id;

    const policy = await prisma.retryPolicy.findFirst({
      where: { name: 'Exponential Backoff Policy' }
    });
    policyId = policy!.id;
  });

  describe('Authentication & Project Management', () => {
    it('should register and login users', async () => {
      const loginRes = await request(server)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body).toHaveProperty('token');
      expect(loginRes.body.user.email).toBe('test@example.com');
    });

    it('should create new projects and queues', async () => {
      const projRes = await request(server)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Analytics Project' });

      expect(projRes.status).toBe(201);
      expect(projRes.body.name).toBe('New Analytics Project');

      const queueRes = await request(server)
        .post('/api/queues')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'image-resizer',
          projectId: projRes.body.id,
          priority: 5,
          concurrencyLimit: 2,
          retryPolicyId: policyId,
        });

      expect(queueRes.status).toBe(201);
      expect(queueRes.body.name).toBe('image-resizer');
    });
  });

  describe('Job Lifecycle & Operations', () => {
    it('should create immediate and delayed jobs', async () => {
      const jobRes = await request(server)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({
          queueId,
          payload: JSON.stringify({ userId: 123 }),
          jobType: 'email',
        });

      expect(jobRes.status).toBe(201);
      expect(jobRes.body.status).toBe('QUEUED');
      expect(jobRes.body.scheduledAt).toBeNull();

      const delayedRes = await request(server)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({
          queueId,
          payload: JSON.stringify({ userId: 456 }),
          jobType: 'report',
          delaySecs: 30,
        });

      expect(delayedRes.status).toBe(201);
      expect(delayedRes.body.status).toBe('SCHEDULED');
      expect(delayedRes.body.scheduledAt).not.toBeNull();
    });

    it('should cancel active jobs', async () => {
      const job = await prisma.job.create({
        data: {
          queueId,
          payload: '{}',
          jobType: 'generic',
        },
      });

      const cancelRes = await request(server)
        .post(`/api/jobs/${job.id}/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');
    });
  });

  describe('Concurrency & Atomic Claim Locking', () => {
    it('should claim jobs atomically and prevent duplicate execution', async () => {
      // Create 1 job in the queue
      const job = await prisma.job.create({
        data: {
          queueId,
          payload: '{}',
          jobType: 'generic',
          status: 'QUEUED',
        },
      });

      // Register 5 workers
      const workers = ['w1', 'w2', 'w3', 'w4', 'w5'];
      for (const w of workers) {
        await request(server)
          .post('/api/workers/register')
          .send({ name: w, host: 'localhost' });
      }

      // Execute 5 claims concurrently
      const claimRequests = workers.map((w) =>
        request(server)
          .post('/api/workers/claim')
          .send({ workerId: w })
      );

      const claimResponses = await Promise.all(claimRequests);

      // Verify that exactly 1 worker got the job (status 200) and the rest got 204
      const successClaims = claimResponses.filter((r) => r.status === 200);
      const emptyClaims = claimResponses.filter((r) => r.status === 204);

      expect(successClaims.length).toBe(1);
      expect(emptyClaims.length).toBe(4);

      // Verify that the job status was updated in the DB
      const dbJob = await prisma.job.findUnique({ where: { id: job.id } });
      expect(dbJob!.status).toBe('RUNNING');
      expect(workers).toContain(dbJob!.workerId);
    });
  });

  describe('Retry Policy Strategies & DLQ', () => {
    it('should support exponential backoff retries and route to DLQ on max retries', async () => {
      const workerId = 'test-worker';
      await request(server)
        .post('/api/workers/register')
        .send({ name: workerId, host: 'localhost' });

      // Create a queue with custom retry policy
      const policy = await prisma.retryPolicy.create({
        data: {
          name: 'Quick Exponential',
          strategy: 'EXPONENTIAL',
          baseDelaySecs: 2,
          maxRetries: 2,
          multiplier: 3.0,
        },
      });

      const q = await prisma.queue.create({
        data: {
          name: 'retry-test-queue',
          projectId,
          priority: 5,
          concurrencyLimit: 2,
          retryPolicyId: policy.id,
        },
      });

      // Create job
      const job = await prisma.job.create({
        data: {
          queueId: q.id,
          payload: '{}',
          jobType: 'email',
          status: 'QUEUED',
        },
      });

      // --- ATTEMPT 1 ---
      // Claim job
      let claim = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim.status).toBe(200);

      // Report failure 1
      let fail = await request(server)
        .post('/api/workers/fail')
        .send({
          jobId: job.id,
          workerId,
          errorMessage: 'First API Timeout',
        });
      expect(fail.status).toBe(200);

      // Check job is SCHEDULED for next retry (retry #1)
      let dbJob = await prisma.job.findUnique({ where: { id: job.id } });
      expect(dbJob!.status).toBe('SCHEDULED');
      expect(dbJob!.retriesCount).toBe(1);
      
      // Delay check: baseDelaySecs = 2s, multiplier = 3. delay = 2s
      const delay1 = (dbJob!.scheduledAt!.getTime() - Date.now()) / 1000;
      expect(delay1).toBeGreaterThan(0);
      expect(delay1).toBeLessThanOrEqual(2);

      // Reset scheduledAt to past so we can claim it again immediately
      await prisma.job.update({
        where: { id: job.id },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });

      // --- ATTEMPT 2 ---
      // Claim job
      claim = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim.status).toBe(200);

      // Report failure 2
      fail = await request(server)
        .post('/api/workers/fail')
        .send({
          jobId: job.id,
          workerId,
          errorMessage: 'Second Connection Timeout',
        });
      expect(fail.status).toBe(200);

      // Check job is SCHEDULED for next retry (retry #2)
      dbJob = await prisma.job.findUnique({ where: { id: job.id } });
      expect(dbJob!.status).toBe('SCHEDULED');
      expect(dbJob!.retriesCount).toBe(2);

      // Delay check: baseDelaySecs * multiplier^(retries - 1) = 2 * 3^1 = 6s
      const delay2 = (dbJob!.scheduledAt!.getTime() - Date.now()) / 1000;
      expect(delay2).toBeGreaterThan(2);
      expect(delay2).toBeLessThanOrEqual(6.1);

      // Reset scheduledAt to past
      await prisma.job.update({
        where: { id: job.id },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });

      // --- ATTEMPT 3 (EXCEEDS MAX RETRIES = 2) ---
      // Claim job
      claim = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim.status).toBe(200);

      // Report failure 3
      fail = await request(server)
        .post('/api/workers/fail')
        .send({
          jobId: job.id,
          workerId,
          errorMessage: 'Third Connection Timeout',
        });
      expect(fail.status).toBe(200);

      // Check job is permanently FAILED and moved to DLQ
      dbJob = await prisma.job.findUnique({ where: { id: job.id } });
      expect(dbJob!.status).toBe('FAILED');
      expect(dbJob!.retriesCount).toBe(3);

      const dlq = await prisma.deadLetterJob.findFirst({
        where: { jobId: job.id },
      });
      expect(dlq).not.toBeNull();
      expect(dlq!.errorReason).toBe('Third Connection Timeout');
    });
  });

  describe('Sliding Window Rate Limiting', () => {
    it('should enforce rate limits and skip queues when execution limit is reached in the window', async () => {
      // Create a new queue with rate limit: max 1 job per 10 seconds
      const rateLimitQueueName = 'rate-limited-queue';
      const queueRes = await request(server)
        .post('/api/queues')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: rateLimitQueueName,
          projectId,
          priority: 5,
          concurrencyLimit: 2,
          rateLimitMax: 1,
          rateLimitWindow: 10,
        });
      expect(queueRes.status).toBe(201);
      const limitQueueId = queueRes.body.id;

      // Register worker
      const workerId = 'rate-limit-worker';
      const registerRes = await request(server)
        .post('/api/workers/register')
        .send({ name: workerId, host: 'localhost' });
      expect(registerRes.status).toBe(200);

      // Queue 2 jobs in this queue
      const job1 = await prisma.job.create({
        data: {
          jobType: 'sync',
          payload: '{}',
          queueId: limitQueueId,
          status: 'QUEUED',
        },
      });
      await prisma.job.create({
        data: {
          jobType: 'sync',
          payload: '{}',
          queueId: limitQueueId,
          status: 'QUEUED',
        },
      });

      // 1st claim: should succeed and claim job 1
      const claim1 = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim1.status).toBe(200);
      expect(claim1.body.job).not.toBeNull();
      expect(claim1.body.job.id).toBe(job1.id);

      // 2nd claim: should be SKIPPED because of the rate limit (1 job per 10s already claimed)
      const claim2 = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim2.status).toBe(204); // Skipped queues return 204 No Content
    });
  });

  describe('Job-Level Priority Queuing', () => {
    it('should claim higher priority jobs before lower priority jobs in the same queue', async () => {
      // Create a new queue
      const prioQueueName = 'prio-test-queue';
      const queueRes = await request(server)
        .post('/api/queues')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: prioQueueName,
          projectId,
          priority: 5,
          concurrencyLimit: 2,
        });
      expect(queueRes.status).toBe(201);
      const prioQueueId = queueRes.body.id;

      // Register worker
      const workerId = 'prio-test-worker';
      const registerRes = await request(server)
        .post('/api/workers/register')
        .send({ name: workerId, host: 'localhost' });
      expect(registerRes.status).toBe(200);

      // 1. Create a Low Priority Job (queued first)
      const lowJob = await prisma.job.create({
        data: {
          jobType: 'sync',
          payload: '{}',
          queueId: prioQueueId,
          status: 'QUEUED',
          priority: 1, // Low
        },
      });

      // 2. Create a High Priority Job (queued second)
      const highJob = await prisma.job.create({
        data: {
          jobType: 'sync',
          payload: '{}',
          queueId: prioQueueId,
          status: 'QUEUED',
          priority: 10, // High
        },
      });

      // Claim job: should claim the High Priority Job (highJob) first, despite being queued second!
      const claim = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim.status).toBe(200);
      expect(claim.body.job).not.toBeNull();
      expect(claim.body.job.id).toBe(highJob.id); // High priority job claimed!

      // Claim second job: should claim the Low Priority Job
      const claim2 = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim2.status).toBe(200);
      expect(claim2.body.job).not.toBeNull();
      expect(claim2.body.job.id).toBe(lowJob.id); // Low priority job claimed second!
    });
  });

  describe('Distributed Queue Sharding', () => {
    it('should distribute jobs across shards and poll deterministically with work stealing failover', async () => {
      // 1. Create a Queue sharded into 2 virtual shards
      const shardQueueName = 'shard-test-queue';
      const queueRes = await request(server)
        .post('/api/queues')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: shardQueueName,
          projectId,
          priority: 5,
          concurrencyLimit: 5,
          shardsCount: 2, // 2 virtual shards
        });
      expect(queueRes.status).toBe(201);
      const shardQueueId = queueRes.body.id;

      // 2. Spawn 4 jobs (randomly assigned to shard 0 or shard 1)
      const jobIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await request(server)
          .post('/api/jobs')
          .set('Authorization', `Bearer ${token}`)
          .send({
            queueId: shardQueueId,
            payload: JSON.stringify({ index: i }),
            jobType: 'sync',
          });
        expect(res.status).toBe(201);
        jobIds.push(res.body.id);
      }

      // Assert that jobs have been assigned shardId 0 or 1
      const dbJobs = await prisma.job.findMany({
        where: { queueId: shardQueueId },
      });
      expect(dbJobs.length).toBe(4);
      dbJobs.forEach(job => {
        expect([0, 1]).toContain(job.shardId);
      });

      // 3. Register a worker
      const workerId = 'shard-worker-1';
      const registerRes = await request(server)
        .post('/api/workers/register')
        .send({ name: workerId, host: 'localhost' });
      expect(registerRes.status).toBe(200);

      // 4. Claim a job: worker should successfully claim a job using deterministic hashing / work stealing fallback
      const claim = await request(server)
        .post('/api/workers/claim')
        .send({ workerId });
      expect(claim.status).toBe(200);
      expect(claim.body.job).not.toBeNull();
      expect(claim.body.job.queueId).toBe(shardQueueId);
    });
  });
});

