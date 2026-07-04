import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './middleware/auth';
import prisma from './prisma';

// Route imports
import authRouter from './routes/auth';
import projectsRouter from './routes/projects';
import queuesRouter from './routes/queues';
import jobsRouter from './routes/jobs';
import workersRouter from './routes/workers';
import metricsRouter from './routes/metrics';
import { authMiddleware } from './middleware/auth';

const app = express();

app.use(cors());
app.use(express.json());

// Register API Routes
app.use('/api/auth', authRouter);
app.use('/api/projects', authMiddleware, projectsRouter);
app.use('/api/queues', authMiddleware, queuesRouter);
app.use('/api/jobs', authMiddleware, jobsRouter);
app.use('/api/workers', workersRouter); // worker API endpoints
app.use('/api/metrics', authMiddleware, metricsRouter);

// Base route
app.get('/', (req, res) => {
  res.json({ message: 'Distributed Job Scheduler API is online.' });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Express Error Handler]:', err);
  const status = err.status || 500;
  return res.status(status).json({
    error: err.message || 'Internal server error',
    details: err.details || undefined,
  });
});

const server = http.createServer(app);

// Live update WebSocket logic
const wss = new WebSocketServer({ noServer: true });

// Map to track active WebSocket subscriptions: socket -> organizationId
const subscriptions = new Map<WebSocket, string>();

wss.on('connection', (ws: WebSocket) => {
  console.log('[WebSocket] Client connected');

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'subscribe') {
        const token = data.token;
        if (!token) {
          ws.send(JSON.stringify({ type: 'error', message: 'Token required' }));
          return;
        }

        // Verify token
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as { organizationId: string };
          subscriptions.set(ws, decoded.organizationId);
          ws.send(JSON.stringify({ type: 'subscribed', message: 'Subscribed to organization live metrics' }));
        } catch (jwtErr) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
        }
      }
    } catch (parseErr) {
      console.error('[WebSocket] Message parse error:', parseErr);
    }
  });

  ws.on('close', () => {
    subscriptions.delete(ws);
    console.log('[WebSocket] Client disconnected');
  });
});

// Upgrade HTTP to WS
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Periodically push live metrics to subscribed sockets
const metricsInterval = setInterval(async () => {
  if (subscriptions.size === 0) return;

  // Group sockets by organizationId to avoid duplicate database queries
  const orgSockets = new Map<string, WebSocket[]>();
  for (const [ws, orgId] of subscriptions.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      const list = orgSockets.get(orgId) || [];
      list.push(ws);
      orgSockets.set(orgId, list);
    }
  }

  for (const [orgId, sockets] of orgSockets.entries()) {
    try {
      // 1. Fetch metrics (replicating metrics endpoint logic)
      const statusCounts = await prisma.job.groupBy({
        by: ['status'],
        where: {
          queue: { project: { organizationId: orgId } },
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

      const queues = await prisma.queue.findMany({
        where: { project: { organizationId: orgId } },
        include: {
          project: { select: { name: true } },
          _count: { select: { jobs: true, scheduledJobs: true } },
        },
      });

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
            if (c.status in countsObj) countsObj[c.status] = c._count._all;
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

      const workerSummary = await prisma.worker.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      const workerStats = { active: 0, inactive: 0 };
      workerSummary.forEach((w) => {
        if (w.status === 'ACTIVE') workerStats.active = w._count._all;
        if (w.status === 'INACTIVE') workerStats.inactive = w._count._all;
      });

      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const recentExecutions = await prisma.jobExecution.findMany({
        where: {
          startedAt: { gte: sixHoursAgo },
          job: { queue: { project: { organizationId: orgId } } },
        },
        select: { status: true, startedAt: true },
        orderBy: { startedAt: 'asc' },
      });

      const bucketSizeMs = 10 * 60 * 1000;
      const buckets: Record<string, { time: string; completed: number; failed: number }> = {};
      for (let i = 0; i < 36; i++) {
        const bucketTime = new Date(sixHoursAgo.getTime() + i * bucketSizeMs);
        const key = bucketTime.toISOString().substring(0, 16);
        const label = bucketTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        buckets[key] = { time: label, completed: 0, failed: 0 };
      }

      recentExecutions.forEach((exec) => {
        const execTimeMs = exec.startedAt.getTime();
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

      const avgDurationObj = await prisma.jobExecution.aggregate({
        where: {
          status: 'COMPLETED',
          startedAt: { gte: sixHoursAgo },
          job: { queue: { project: { organizationId: orgId } } },
        },
        _avg: { durationMs: true },
      });

      const payload = JSON.stringify({
        type: 'metrics',
        data: {
          statusCounts: statusObj,
          queueStats,
          workerStats,
          throughput: throughputData,
          avgDurationMs: Math.round(avgDurationObj._avg.durationMs || 0),
        },
      });

      // Broadcast to all sockets of this organization
      sockets.forEach((s) => s.send(payload));
    } catch (metricErr) {
      console.error(`[WebSocket] Failed to fetch live metrics for org ${orgId}:`, metricErr);
    }
  }
}, 2000);

export function stopMetricsInterval() {
  clearInterval(metricsInterval);
}

export { server };
