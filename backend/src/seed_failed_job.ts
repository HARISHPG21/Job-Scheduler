import prisma from './prisma';

async function run() {
  // Find a queue
  const queue = await prisma.queue.findFirst();
  if (!queue) {
    console.error('No queues found in database. Seed the database first!');
    return;
  }
  
  // Create a failed job in the database
  const failedJob = await prisma.job.create({
    data: {
      queueId: queue.id,
      jobType: 'data_sync',
      payload: JSON.stringify({ service: 'stripe', syncType: 'refunds' }),
      status: 'FAILED',
      failedAt: new Date(),
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      retriesCount: 4,
      maxRetries: 3,
    },
  });

  // Create the DLQ entry
  const dlq = await prisma.deadLetterJob.create({
    data: {
      jobId: failedJob.id,
      queueId: queue.id,
      payload: failedJob.payload,
      jobType: failedJob.jobType,
      errorReason: 'Stripe API authentication failed: invalid secret key provided.',
      failedAt: failedJob.failedAt!,
    },
  });

  // Create log entries for diagnostics
  await prisma.jobLog.create({
    data: {
      jobId: failedJob.id,
      level: 'INFO',
      message: 'Job triggered and claimed by worker Worker-19452.',
    },
  });
  await prisma.jobLog.create({
    data: {
      jobId: failedJob.id,
      level: 'ERROR',
      message: 'Job execution failed: Stripe API authentication failed.',
    },
  });
  await prisma.jobLog.create({
    data: {
      jobId: failedJob.id,
      level: 'ERROR',
      message: 'Job exceeded max retries (3). Moved to Dead Letter Queue (DLQ).',
    },
  });

  console.log('Successfully created failed job and DLQ entry:', dlq.id);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
