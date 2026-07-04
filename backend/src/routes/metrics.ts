import { Router, Response } from 'express';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = req.organizationId!;

    // 1. Job counts by status
    const statusCounts = await prisma.job.groupBy({
      by: ['status'],
      where: {
        queue: {
          project: { organizationId: orgId },
        },
      },
      _count: { _all: true },
    });

    const statusObj: Record<string, number> = {
      QUEUED: 0,
      SCHEDULED: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };

    statusCounts.forEach((sc) => {
      statusObj[sc.status] = sc._count._all;
    });

    // 2. Queue performance statistics
    const queues = await prisma.queue.findMany({
      where: {
        project: { organizationId: orgId },
      },
      include: {
        project: { select: { name: true } },
        _count: {
          select: {
            jobs: true,
            scheduledJobs: true,
          },
        },
      },
    });

    // Count jobs by status for each queue
    const queueStats = await Promise.all(
      queues.map(async (q) => {
        const counts = await prisma.job.groupBy({
          by: ['status'],
          where: { queueId: q.id },
          _count: { _all: true },
        });

        const countsObj: Record<string, number> = {
          QUEUED: 0,
          SCHEDULED: 0,
          RUNNING: 0,
          COMPLETED: 0,
          FAILED: 0,
        };

        counts.forEach((c) => {
          if (c.status in countsObj) {
            countsObj[c.status] = c._count._all;
          }
        });

        return {
          id: q.id,
          name: q.name,
          projectName: q.project.name,
          priority: q.priority,
          concurrencyLimit: q.concurrencyLimit,
          isPaused: q.isPaused,
          counts: countsObj,
          totalJobs: q._count.jobs,
          scheduledCount: q._count.scheduledJobs,
        };
      })
    );

    // 3. Worker Status Summary
    const workerSummary = await prisma.worker.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const workerStats = {
      active: 0,
      inactive: 0,
    };

    workerSummary.forEach((w) => {
      if (w.status === 'ACTIVE') workerStats.active = w._count._all;
      if (w.status === 'INACTIVE') workerStats.inactive = w._count._all;
    });

    // 4. Job Executions in the last 6 hours (throughput chart)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentExecutions = await prisma.jobExecution.findMany({
      where: {
        startedAt: { gte: sixHoursAgo },
        job: {
          queue: {
            project: { organizationId: orgId },
          },
        },
      },
      select: {
        status: true,
        startedAt: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    // Group recent executions into 10-minute buckets
    const bucketSizeMs = 10 * 60 * 1000; // 10 minutes
    const buckets: Record<string, { time: string; completed: number; failed: number }> = {};

    // Initialize buckets
    for (let i = 0; i < 36; i++) {
      const bucketTime = new Date(sixHoursAgo.getTime() + i * bucketSizeMs);
      const key = bucketTime.toISOString().substring(0, 16); // YYYY-MM-DDTHH:mm
      const label = bucketTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      buckets[key] = { time: label, completed: 0, failed: 0 };
    }

    recentExecutions.forEach((exec) => {
      const execTimeMs = exec.startedAt.getTime();
      // Find closest bucket
      const offsetMs = execTimeMs - sixHoursAgo.getTime();
      const bucketIdx = Math.floor(offsetMs / bucketSizeMs);
      if (bucketIdx >= 0 && bucketIdx < 36) {
        const bucketTime = new Date(sixHoursAgo.getTime() + bucketIdx * bucketSizeMs);
        const key = bucketTime.toISOString().substring(0, 16);
        if (buckets[key]) {
          if (exec.status === 'COMPLETED') buckets[key].completed++;
          if (exec.status === 'FAILED') buckets[key].failed++;
        }
      }
    });

    const throughputData = Object.values(buckets);

    // 5. Avg duration of completed jobs
    const avgDurationObj = await prisma.jobExecution.aggregate({
      where: {
        status: 'COMPLETED',
        startedAt: { gte: sixHoursAgo },
        job: {
          queue: {
            project: { organizationId: orgId },
          },
        },
      },
      _avg: {
        durationMs: true,
      },
    });

    return res.json({
      statusCounts: statusObj,
      queueStats,
      workerStats,
      throughput: throughputData,
      avgDurationMs: Math.round(avgDurationObj._avg.durationMs || 0),
    });
  } catch (err) {
    console.error('Get metrics error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
