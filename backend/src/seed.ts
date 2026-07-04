import bcrypt from 'bcryptjs';
import prisma from './prisma';

async function main() {
  console.log('Seeding database...');

  // Clean existing tables to prevent unique constraint failures
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

  // 1. Create Organization
  const org = await prisma.organization.create({
    data: {
      name: 'Job Scheduler',
    },
  });
  console.log(`Created Organization: ${org.name} (${org.id})`);

  // 2. Create User
  const passwordHash = await bcrypt.hash('password123', 10);
  const user = await prisma.user.create({
    data: {
      email: 'admin@acme.com',
      passwordHash,
      name: 'P.G.Harish',
      role: 'ADMIN',
      organizationId: org.id,
    },
  });
  console.log(`Created Admin User: ${user.name} (${user.email})`);

  // 3. Create Project
  const project = await prisma.project.create({
    data: {
      name: 'Data Processing Hub',
      organizationId: org.id,
    },
  });
  console.log(`Created Project: ${project.name}`);

  // 4. Create Retry Policies
  const fixedPolicy = await prisma.retryPolicy.create({
    data: {
      name: 'Fixed Delay (5s)',
      strategy: 'FIXED',
      baseDelaySecs: 5,
      maxRetries: 3,
    },
  });

  const linearPolicy = await prisma.retryPolicy.create({
    data: {
      name: 'Linear Backoff (10s)',
      strategy: 'LINEAR',
      baseDelaySecs: 10,
      maxRetries: 3,
    },
  });

  const expoPolicy = await prisma.retryPolicy.create({
    data: {
      name: 'Exponential Backoff (2s, mult 2)',
      strategy: 'EXPONENTIAL',
      baseDelaySecs: 2,
      maxRetries: 4,
      multiplier: 2.0,
    },
  });
  console.log('Created Retry Policies: Fixed, Linear, Exponential');

  // 5. Create Queues
  const defaultQueue = await prisma.queue.create({
    data: {
      name: 'default-queue',
      projectId: project.id,
      priority: 1,
      concurrencyLimit: 5,
      retryPolicyId: expoPolicy.id,
    },
  });

  const highQueue = await prisma.queue.create({
    data: {
      name: 'critical-queue',
      projectId: project.id,
      priority: 10, // high priority
      concurrencyLimit: 8,
      retryPolicyId: fixedPolicy.id,
    },
  });

  const lowQueue = await prisma.queue.create({
    data: {
      name: 'background-sync',
      projectId: project.id,
      priority: 2,
      concurrencyLimit: 2,
      retryPolicyId: linearPolicy.id,
      rateLimitMax: 10,
      rateLimitWindow: 60, // Sliding window rate limit: max 10 jobs per 60 seconds
    },
  });
  console.log(`Created Queues: ${defaultQueue.name}, ${highQueue.name}, ${lowQueue.name}`);

  // 6. Create a few initial mock jobs in the queues
  // A completed job
  await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      jobType: 'email',
      payload: JSON.stringify({ to: 'user@example.com', subject: 'Welcome!', body: 'Hello!' }),
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 30 * 60 * 1000),
      createdAt: new Date(Date.now() - 32 * 60 * 1000),
    },
  });

  // A failed job that went to DLQ
  const failedJob = await prisma.job.create({
    data: {
      queueId: lowQueue.id,
      jobType: 'data_sync',
      payload: JSON.stringify({ service: 'salesforce', entities: ['leads', 'accounts'] }),
      status: 'FAILED',
      failedAt: new Date(Date.now() - 10 * 60 * 1000),
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
      retriesCount: 4,
      maxRetries: 3,
    },
  });

  await prisma.deadLetterJob.create({
    data: {
      jobId: failedJob.id,
      queueId: lowQueue.id,
      payload: failedJob.payload,
      jobType: failedJob.jobType,
      errorReason: 'Salesforce API limit reached (403 Forbidden)',
      failedAt: failedJob.failedAt!,
    },
  });

  // A queued job
  await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      jobType: 'report',
      payload: JSON.stringify({ reportId: 'REP-9928', format: 'pdf' }),
      status: 'QUEUED',
    },
  });

  // A scheduled job (delayed execution)
  await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      jobType: 'data_sync',
      payload: JSON.stringify({ action: 'rebuild-indices' }),
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 10 * 60 * 1000), // 10 mins from now
    },
  });

  // A recurring Cron scheduled job
  await prisma.scheduledJob.create({
    data: {
      name: 'Hourly DB Cleanup',
      queueId: highQueue.id,
      cronExpression: '0 * * * *',
      jobType: 'db_maintenance',
      jobPayload: JSON.stringify({ cleanOrphans: true }),
      nextRunAt: new Date(Date.now() + 50 * 60 * 1000), // 50 mins from now
    },
  });

  console.log('Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
