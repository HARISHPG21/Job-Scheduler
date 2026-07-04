import { Router, Response } from 'express';
import { z } from 'zod';
import parser from 'cron-parser';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const JobCreateSchema = z.object({
  queueId: z.string(),
  payload: z.string(),
  jobType: z.string().default('generic'),
  delaySecs: z.number().int().min(0).optional(),
  cronExpression: z.string().optional(),
  cronName: z.string().optional(),
  parentJobId: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(10).optional().default(1),
});

const BatchJobCreateSchema = z.object({
  queueId: z.string(),
  jobType: z.string().default('generic'),
  jobs: z.array(z.object({
    payload: z.string(),
    delaySecs: z.number().int().min(0).optional(),
    parentJobId: z.string().nullable().optional(),
  })),
});

// Get all jobs (with filtering, pagination)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const queueId = req.query.queueId as string | undefined;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const whereClause: any = {
      queue: {
        project: { organizationId: req.organizationId },
      },
    };

    if (queueId) whereClause.queueId = queueId;
    if (status) whereClause.status = status;
    if (search) {
      whereClause.payload = { contains: search };
    }

    const [jobs, totalCount] = await Promise.all([
      prisma.job.findMany({
        where: whereClause,
        include: {
          queue: { select: { name: true, project: { select: { name: true } } } },
          worker: { select: { name: true } },
          parentJob: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.job.count({ where: whereClause }),
    ]);

    return res.json({
      jobs,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err) {
    console.error('Get jobs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a job (immediate, delayed, or cron schedule)
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { queueId, payload, jobType, delaySecs, cronExpression, cronName, parentJobId, priority } = JobCreateSchema.parse(req.body);

    // Verify queue belongs to organization
    const queue = await prisma.queue.findFirst({
      where: { id: queueId, project: { organizationId: req.organizationId } },
    });
    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    // Check if it's a cron (recurring) job
    if (cronExpression) {
      try {
        const cronInterval = parser.parseExpression(cronExpression);
        const nextRunAt = cronInterval.next().toDate();

        const scheduledJob = await prisma.scheduledJob.create({
          data: {
            name: cronName || `Cron-${jobType}`,
            queueId,
            cronExpression,
            jobType,
            jobPayload: payload,
            nextRunAt,
          },
        });
        return res.status(201).json({ scheduledJob, message: 'Cron job scheduled successfully' });
      } catch (cronErr) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
    }

    // Simple / Delayed job
    let scheduledAt: Date | null = null;
    if (delaySecs && delaySecs > 0) {
      scheduledAt = new Date(Date.now() + delaySecs * 1000);
    }

    const shardId = queue.shardsCount > 1 ? Math.floor(Math.random() * queue.shardsCount) : 0;

    const job = await prisma.job.create({
      data: {
        queueId,
        payload,
        jobType,
        scheduledAt,
        status: scheduledAt ? 'SCHEDULED' : 'QUEUED',
        parentJobId: parentJobId || null,
        priority: priority !== undefined ? priority : 1,
        shardId,
      },
    });

    return res.status(201).json(job);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Create job error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create batch of jobs
router.post('/batch', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { queueId, jobType, jobs } = BatchJobCreateSchema.parse(req.body);

    const queue = await prisma.queue.findFirst({
      where: { id: queueId, project: { organizationId: req.organizationId } },
    });
    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const createdJobs = await prisma.$transaction(
      jobs.map((j) => {
        let scheduledAt: Date | null = null;
        if (j.delaySecs && j.delaySecs > 0) {
          scheduledAt = new Date(Date.now() + j.delaySecs * 1000);
        }
        const shardId = queue.shardsCount > 1 ? Math.floor(Math.random() * queue.shardsCount) : 0;
        return prisma.job.create({
          data: {
            queueId,
            payload: j.payload,
            jobType,
            scheduledAt,
            status: scheduledAt ? 'SCHEDULED' : 'QUEUED',
            parentJobId: j.parentJobId || null,
            shardId,
          },
        });
      })
    );

    return res.status(201).json(createdJobs);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Create batch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Cron Scheduled jobs
router.get('/scheduled', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scheduled = await prisma.scheduledJob.findMany({
      where: {
        queue: { project: { organizationId: req.organizationId } },
      },
      include: {
        queue: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(scheduled);
  } catch (err) {
    console.error('Get scheduled jobs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete/Deactivate scheduled job
router.delete('/scheduled/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sched = await prisma.scheduledJob.findFirst({
      where: {
        id,
        queue: { project: { organizationId: req.organizationId } },
      },
    });
    if (!sched) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }
    await prisma.scheduledJob.delete({ where: { id } });
    return res.json({ message: 'Scheduled job deleted successfully' });
  } catch (err) {
    console.error('Delete scheduled job error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Dead Letter Queue jobs
router.get('/dlq', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dlq = await prisma.deadLetterJob.findMany({
      where: {
        queue: { project: { organizationId: req.organizationId } },
      },
      include: {
        queue: { select: { name: true } },
        job: { select: { status: true, retriesCount: true, maxRetries: true } },
      },
      orderBy: { failedAt: 'desc' },
    });
    return res.json(dlq);
  } catch (err) {
    console.error('Get DLQ error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function getAiFailureSummary(errorMessage: string): string {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('timeout') || msg.includes('etimedout')) {
    return '🚨 AI DIAGNOSIS: Network Timeout. The connection to the external API exceeded the 5000ms threshold. RECOMMENDATION: Check external service status, verify network gateways, or increase retry policies.';
  }
  if (msg.includes('403') || msg.includes('forbidden') || msg.includes('unauthorized') || msg.includes('401')) {
    return '🔑 AI DIAGNOSIS: Authentication Failure. The target service rejected the credentials. RECOMMENDATION: Verify API keys, rotate access tokens, and check header formatting.';
  }
  if (msg.includes('salesforce') || msg.includes('stripe')) {
    return '☁️ AI DIAGNOSIS: Integration Error. The external SaaS provider returned a bad response. RECOMMENDATION: Inspect payload structure, verify tenant limits, and retry with backoff.';
  }
  if (msg.includes('database') || msg.includes('unique') || msg.includes('constraint')) {
    return '💾 AI DIAGNOSIS: Database Constraint Violation. Duplicate entry or relational conflict in tables. RECOMMENDATION: Review database schema constraints, verify payload IDs, and check for duplicate events.';
  }
  if (msg.includes('crashed') || msg.includes('heartbeat') || msg.includes('offline') || msg.includes('timed out')) {
    return '💀 AI DIAGNOSIS: Worker Node Failure. The worker process died or lost network connection during execution. RECOMMENDATION: Check worker service health, monitor memory load, and increase worker count.';
  }
  
  return `💡 AI DIAGNOSIS: Execution Exception. The worker returned: "${errorMessage}". RECOMMENDATION: Debug worker logic, inspect stack trace details, and ensure payload satisfies requirements.`;
}

// Get job details & history
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { organizationId: req.organizationId } },
      },
      include: {
        queue: { select: { name: true, project: { select: { name: true } } } },
        worker: { select: { name: true } },
        executions: {
          orderBy: { startedAt: 'desc' },
        },
        logs: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Generate AI failure summary if the job failed
    let aiSummary: string | null = null;
    if (job.status === 'FAILED' && job.executions.length > 0) {
      const lastFailedExecution = job.executions.find(e => e.status === 'FAILED');
      if (lastFailedExecution && lastFailedExecution.errorMessage) {
        aiSummary = getAiFailureSummary(lastFailedExecution.errorMessage);
      }
    }

    return res.json({
      ...job,
      aiSummary
    });
  } catch (err) {
    console.error('Get job details error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Retry a failed job manually
router.post('/:id/retry', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { organizationId: req.organizationId } },
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
      return res.status(400).json({ error: 'Only failed or cancelled jobs can be retried' });
    }

    // Update job status to QUEUED and reset counts
    const updatedJob = await prisma.job.update({
      where: { id },
      data: {
        status: 'QUEUED',
        retriesCount: 0,
        failedAt: null,
        completedAt: null,
        claimedAt: null,
        workerId: null,
      },
    });

    await prisma.jobLog.create({
      data: {
        jobId: id,
        level: 'INFO',
        message: 'Job manually triggered for retry',
      },
    });

    // Also remove from DLQ if exists
    await prisma.deadLetterJob.deleteMany({
      where: { jobId: id },
    });

    return res.json(updatedJob);
  } catch (err) {
    console.error('Retry job error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel a job
router.post('/:id/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { organizationId: req.organizationId } },
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      return res.status(400).json({ error: 'Cannot cancel a completed, failed, or already cancelled job' });
    }

    const updatedJob = await prisma.job.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await prisma.jobLog.create({
      data: {
        jobId: id,
        level: 'WARN',
        message: 'Job cancelled by user',
      },
    });

    return res.json(updatedJob);
  } catch (err) {
    console.error('Cancel job error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Retry a DLQ entry
router.post('/dlq/:id/retry', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const dlq = await prisma.deadLetterJob.findFirst({
      where: {
        id,
        queue: { project: { organizationId: req.organizationId } },
      },
    });

    if (!dlq) {
      return res.status(404).json({ error: 'DLQ entry not found' });
    }

    if (dlq.jobId) {
      // Re-queue existing job
      await prisma.$transaction([
        prisma.job.update({
          where: { id: dlq.jobId },
          data: {
            status: 'QUEUED',
            retriesCount: 0,
            failedAt: null,
            workerId: null,
          },
        }),
        prisma.jobLog.create({
          data: {
            jobId: dlq.jobId,
            level: 'INFO',
            message: 'Job retried from Dead Letter Queue',
          },
        }),
        prisma.deadLetterJob.delete({ where: { id } }),
      ]);
    } else {
      // Re-queue by creating a new job (job was deleted but DLQ entry preserved)
      await prisma.$transaction([
        prisma.job.create({
          data: {
            queueId: dlq.queueId,
            payload: dlq.payload,
            jobType: dlq.jobType,
            status: 'QUEUED',
          },
        }),
        prisma.deadLetterJob.delete({ where: { id } }),
      ]);
    }

    return res.json({ message: 'Job successfully retried from DLQ' });
  } catch (err) {
    console.error('Retry DLQ error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a DLQ entry
router.delete('/dlq/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const dlq = await prisma.deadLetterJob.findFirst({
      where: {
        id,
        queue: { project: { organizationId: req.organizationId } },
      },
    });

    if (!dlq) {
      return res.status(404).json({ error: 'DLQ entry not found' });
    }

    await prisma.deadLetterJob.delete({ where: { id } });
    return res.json({ message: 'DLQ entry deleted successfully' });
  } catch (err) {
    console.error('Delete DLQ entry error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Purge all DLQ entries
router.post('/dlq/purge', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.deadLetterJob.deleteMany({
      where: {
        queue: { project: { organizationId: req.organizationId } },
      },
    });
    return res.json({ message: 'DLQ purged successfully' });
  } catch (err) {
    console.error('Purge DLQ error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Retry all DLQ entries
router.post('/dlq/retry-all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dlqEntries = await prisma.deadLetterJob.findMany({
      where: {
        queue: { project: { organizationId: req.organizationId } },
      },
    });

    for (const entry of dlqEntries) {
      if (entry.jobId) {
        await prisma.job.update({
          where: { id: entry.jobId },
          data: {
            status: 'QUEUED',
            retriesCount: 0,
            failedAt: null,
            workerId: null,
          },
        });
        await prisma.jobLog.create({
          data: {
            jobId: entry.jobId,
            level: 'INFO',
            message: 'Job retried from DLQ (bulk)',
          },
        });
      } else {
        await prisma.job.create({
          data: {
            queueId: entry.queueId,
            payload: entry.payload,
            jobType: entry.jobType,
            status: 'QUEUED',
          },
        });
      }
    }

    await prisma.deadLetterJob.deleteMany({
      where: {
        queue: { project: { organizationId: req.organizationId } },
      },
    });

    return res.json({ message: `Successfully retried ${dlqEntries.length} jobs from DLQ` });
  } catch (err) {
    console.error('Retry all DLQ error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
