import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';

const router = Router();

const RegisterWorkerSchema = z.object({
  name: z.string(),
  host: z.string(),
});

const HeartbeatWorkerSchema = z.object({
  workerId: z.string(),
  cpuUsage: z.number().min(0).max(100),
  ramUsage: z.number().min(0).max(100),
  activeJobsCount: z.number().int().min(0),
});

const ClaimJobSchema = z.object({
  workerId: z.string(),
});

const CompleteJobSchema = z.object({
  jobId: z.string(),
  workerId: z.string(),
  output: z.string().optional(),
});

const FailJobSchema = z.object({
  jobId: z.string(),
  workerId: z.string(),
  errorMessage: z.string(),
});

// Register worker
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, host } = RegisterWorkerSchema.parse(req.body);
    const worker = await prisma.worker.upsert({
      where: { id: name }, // let's use the worker name or a uuid as ID. UPSERT based on ID/name makes it re-entrant
      update: {
        host,
        status: 'ACTIVE',
        lastHeartbeatAt: new Date(),
      },
      create: {
        id: name, // We can let worker pass its name as ID
        name,
        host,
        status: 'ACTIVE',
      },
    });

    await prisma.workerHeartbeat.create({
      data: {
        workerId: worker.id,
        cpuUsage: 0,
        ramUsage: 0,
        activeJobsCount: 0,
      },
    });

    return res.status(200).json(worker);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Worker registration error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Worker heartbeat
router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const { workerId, cpuUsage, ramUsage, activeJobsCount } = HeartbeatWorkerSchema.parse(req.body);

    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Update worker status and lastHeartbeatAt
    await prisma.worker.update({
      where: { id: workerId },
      data: {
        status: 'ACTIVE',
        lastHeartbeatAt: new Date(),
      },
    });

    // Store heartbeat metrics
    await prisma.workerHeartbeat.create({
      data: {
        workerId,
        cpuUsage,
        ramUsage,
        activeJobsCount,
      },
    });

    return res.json({ status: 'ok' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Worker heartbeat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// List all workers (admin/dashboard query)
router.get('/', async (req: Request, res: Response) => {
  try {
    const workers = await prisma.worker.findMany({
      include: {
        heartbeats: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            jobs: {
              where: { status: 'RUNNING' },
            },
          },
        },
      },
      orderBy: { lastHeartbeatAt: 'desc' },
    });
    return res.json(workers);
  } catch (err) {
    console.error('Get workers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Claim a job atomically
// Workers call POST /api/workers/claim
router.post('/claim', async (req: Request, res: Response) => {
  try {
    const { workerId } = ClaimJobSchema.parse(req.body);

    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Interactive transaction to atomically find and claim a job
    const claimedJob = await prisma.$transaction(async (tx) => {
      // Find all queues, ordered by priority (highest first)
      const queues = await tx.queue.findMany({
        where: { isPaused: false },
        orderBy: { priority: 'desc' },
      });

      for (const queue of queues) {
        // Calculate number of active jobs currently running in this queue
        const activeJobs = await tx.job.count({
          where: {
            queueId: queue.id,
            status: { in: ['CLAIMED', 'RUNNING'] },
          },
        });

        // Skip queue if it is at its concurrency limit
        if (activeJobs >= queue.concurrencyLimit) {
          continue;
        }

        // Check sliding window rate limiting if configured
        if (queue.rateLimitMax && queue.rateLimitWindow) {
          const windowStart = new Date(Date.now() - queue.rateLimitWindow * 1000);
          const executionsInWindow = await tx.jobExecution.count({
            where: {
              job: { queueId: queue.id },
              startedAt: { gte: windowStart },
            },
          });

          if (executionsInWindow >= queue.rateLimitMax) {
            continue; // Skip queue due to rate limit
          }
        }

        // Determine deterministic worker shard based on workerId and shardsCount
        let workerShardId = 0;
        if (queue.shardsCount > 1) {
          let hash = 0;
          for (let i = 0; i < workerId.length; i++) {
            hash = workerId.charCodeAt(i) + ((hash << 5) - hash);
          }
          workerShardId = Math.abs(hash) % queue.shardsCount;
        }

        // Find the next eligible job in this queue on the assigned shard
        let eligibleJob = await tx.job.findFirst({
          where: {
            queueId: queue.id,
            shardId: workerShardId,
            status: { in: ['QUEUED', 'SCHEDULED'] },
            AND: [
              {
                OR: [
                  { scheduledAt: null },
                  { scheduledAt: { lte: new Date() } },
                ],
              },
              {
                OR: [
                  { parentJobId: null },
                  {
                    parentJob: {
                      status: 'COMPLETED',
                    },
                  },
                ],
              },
            ],
          },
          orderBy: [
            { priority: 'desc' },
            { createdAt: 'asc' },
          ], // Priority queuing, falling back to FIFO
        });

        // Work Stealing: If assigned shard is empty, poll other shards to keep worker busy
        if (!eligibleJob && queue.shardsCount > 1) {
          eligibleJob = await tx.job.findFirst({
            where: {
              queueId: queue.id,
              status: { in: ['QUEUED', 'SCHEDULED'] },
              AND: [
                {
                  OR: [
                    { scheduledAt: null },
                    { scheduledAt: { lte: new Date() } },
                  ],
                },
                {
                  OR: [
                    { parentJobId: null },
                    {
                      parentJob: {
                        status: 'COMPLETED',
                      },
                    },
                  ],
                },
              ],
            },
            orderBy: [
              { priority: 'desc' },
              { createdAt: 'asc' },
            ],
          });
        }

        if (eligibleJob) {
          // Claim the job atomically
          const updatedJob = await tx.job.update({
            where: { id: eligibleJob.id },
            data: {
              status: 'RUNNING',
              claimedAt: new Date(),
              workerId: workerId,
            },
          });

          // Create an execution record
          const execution = await tx.jobExecution.create({
            data: {
              jobId: updatedJob.id,
              workerId: workerId,
              status: 'RUNNING',
              retryCount: updatedJob.retriesCount,
            },
          });

          // Write a log
          await tx.jobLog.create({
            data: {
              jobId: updatedJob.id,
              level: 'INFO',
              message: `Job claimed and started running on worker ${workerId}. Execution ID: ${execution.id}`,
            },
          });

          return {
            job: updatedJob,
            executionId: execution.id,
          };
        }
      }

      return null; // No jobs available
    });

    if (!claimedJob) {
      return res.status(204).end(); // No job content
    }

    return res.json(claimedJob);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Job claiming error:', err);
    return res.status(500).json({ error: 'Internal server error claiming job' });
  }
});

// Complete job
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const { jobId, workerId, output } = CompleteJobSchema.parse(req.body);

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Find the running execution
    const runningExecution = await prisma.jobExecution.findFirst({
      where: {
        jobId,
        workerId,
        status: 'RUNNING',
      },
      orderBy: { startedAt: 'desc' },
    });

    const now = new Date();
    const durationMs = runningExecution
      ? now.getTime() - runningExecution.startedAt.getTime()
      : null;

    await prisma.$transaction([
      prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          completedAt: now,
        },
      }),
      ...(runningExecution
        ? [
            prisma.jobExecution.update({
              where: { id: runningExecution.id },
              data: {
                status: 'COMPLETED',
                finishedAt: now,
                durationMs,
              },
            }),
          ]
        : []),
      prisma.jobLog.create({
        data: {
          jobId,
          level: 'INFO',
          message: `Job successfully completed execution. Output: ${output || 'No output details provided.'}`,
        },
      }),
    ]);

    return res.json({ status: 'success' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Complete job error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Fail job (with retry policy)
router.post('/fail', async (req: Request, res: Response) => {
  try {
    const { jobId, workerId, errorMessage } = FailJobSchema.parse(req.body);

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        queue: {
          include: { retryPolicy: true },
        },
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const runningExecution = await prisma.jobExecution.findFirst({
      where: {
        jobId,
        workerId,
        status: 'RUNNING',
      },
      orderBy: { startedAt: 'desc' },
    });

    const now = new Date();
    const durationMs = runningExecution
      ? now.getTime() - runningExecution.startedAt.getTime()
      : null;

    // Increment retry count
    const nextRetryCount = job.retriesCount + 1;
    const policy = job.queue.retryPolicy;
    const maxRetries = policy ? policy.maxRetries : job.maxRetries;

    await prisma.$transaction(async (tx) => {
      // Update the execution record first
      if (runningExecution) {
        await tx.jobExecution.update({
          where: { id: runningExecution.id },
          data: {
            status: 'FAILED',
            finishedAt: now,
            durationMs,
            errorMessage,
          },
        });
      }

      await tx.jobLog.create({
        data: {
          jobId,
          level: 'ERROR',
          message: `Execution failed: ${errorMessage}`,
        },
      });

      if (nextRetryCount > maxRetries) {
        // Exceeded max retries: mark as FAILED permanently and move to DLQ
        await tx.job.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            failedAt: now,
            retriesCount: nextRetryCount,
          },
        });

        await tx.deadLetterJob.create({
          data: {
            jobId,
            queueId: job.queueId,
            payload: job.payload,
            jobType: job.jobType,
            errorReason: errorMessage,
          },
        });

        await tx.jobLog.create({
          data: {
            jobId,
            level: 'ERROR',
            message: `Job exceeded max retries (${maxRetries}). Moved to Dead Letter Queue (DLQ).`,
          },
        });
      } else {
        // Retry policy calculations
        let delaySecs = 5; // Default fallback
        if (policy) {
          const { strategy, baseDelaySecs, multiplier } = policy;
          if (strategy === 'FIXED') {
            delaySecs = baseDelaySecs;
          } else if (strategy === 'LINEAR') {
            delaySecs = baseDelaySecs * nextRetryCount;
          } else if (strategy === 'EXPONENTIAL') {
            delaySecs = baseDelaySecs * Math.pow(multiplier, nextRetryCount - 1);
          }
        }

        const scheduledAt = new Date(Date.now() + delaySecs * 1000);

        await tx.job.update({
          where: { id: jobId },
          data: {
            status: 'SCHEDULED',
            retriesCount: nextRetryCount,
            scheduledAt,
            workerId: null, // Disassociate worker for retry
          },
        });

        await tx.jobLog.create({
          data: {
            jobId,
            level: 'WARN',
            message: `Job execution failed. Scheduled retry #${nextRetryCount}/${maxRetries} in ${delaySecs} seconds (at ${scheduledAt.toISOString()})`,
          },
        });
      }
    });

    return res.json({ status: 'failed_logged' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Fail job error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Stream worker execution log back to server
router.post('/jobs/:jobId/log', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const { level, message } = z.object({
      level: z.enum(['INFO', 'WARN', 'ERROR']).default('INFO'),
      message: z.string(),
    }).parse(req.body);

    const log = await prisma.jobLog.create({
      data: {
        jobId,
        level,
        message,
      },
    });

    return res.json(log);
  } catch (err) {
    console.error('Stream worker log error:', err);
    return res.status(500).json({ error: 'Failed to record job log' });
  }
});

export default router;
