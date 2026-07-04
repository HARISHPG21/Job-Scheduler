import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const QueueSchema = z.object({
  name: z.string().min(2),
  projectId: z.string(),
  priority: z.number().int().min(1).default(1),
  concurrencyLimit: z.number().int().min(1).default(5),
  retryPolicyId: z.string().optional(),
  rateLimitMax: z.number().int().min(1).nullable().optional(),
  rateLimitWindow: z.number().int().min(1).nullable().optional(),
  shardsCount: z.number().int().min(1).max(10).optional().default(1),
});

const UpdateQueueSchema = z.object({
  priority: z.number().int().min(1).optional(),
  concurrencyLimit: z.number().int().min(1).optional(),
  isPaused: z.boolean().optional(),
  retryPolicyId: z.string().nullable().optional(),
  rateLimitMax: z.number().int().min(1).nullable().optional(),
  rateLimitWindow: z.number().int().min(1).nullable().optional(),
});

const RetryPolicySchema = z.object({
  name: z.string().min(2),
  strategy: z.enum(['FIXED', 'LINEAR', 'EXPONENTIAL']),
  baseDelaySecs: z.number().int().min(1).default(5),
  maxRetries: z.number().int().min(0).default(3),
  multiplier: z.number().min(1.0).default(1.5),
});

// Get all queues for organization
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const queues = await prisma.queue.findMany({
      where: {
        project: { organizationId: req.organizationId },
      },
      include: {
        project: true,
        retryPolicy: true,
        _count: {
          select: {
            jobs: {
              where: { status: 'RUNNING' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(queues);
  } catch (err) {
    console.error('Get queues error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create queue
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, projectId, priority, concurrencyLimit, retryPolicyId, rateLimitMax, rateLimitWindow, shardsCount } = QueueSchema.parse(req.body);

    // Verify project belongs to organization
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.organizationId },
    });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const queue = await prisma.queue.create({
      data: {
        name,
        projectId,
        priority,
        concurrencyLimit,
        retryPolicyId: retryPolicyId || null,
        rateLimitMax: rateLimitMax || null,
        rateLimitWindow: rateLimitWindow || null,
        shardsCount: shardsCount || 1,
      },
      include: { retryPolicy: true },
    });

    return res.status(201).json(queue);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Create queue error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update queue
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = UpdateQueueSchema.parse(req.body);

    // Verify queue belongs to user's organization
    const queue = await prisma.queue.findFirst({
      where: {
        id,
        project: { organizationId: req.organizationId },
      },
    });

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const updatedQueue = await prisma.queue.update({
      where: { id },
      data: {
        priority: updateData.priority !== undefined ? updateData.priority : undefined,
        concurrencyLimit: updateData.concurrencyLimit !== undefined ? updateData.concurrencyLimit : undefined,
        isPaused: updateData.isPaused !== undefined ? updateData.isPaused : undefined,
        retryPolicyId: updateData.retryPolicyId !== undefined ? updateData.retryPolicyId : undefined,
        rateLimitMax: updateData.rateLimitMax !== undefined ? updateData.rateLimitMax : undefined,
        rateLimitWindow: updateData.rateLimitWindow !== undefined ? updateData.rateLimitWindow : undefined,
      },
      include: { retryPolicy: true },
    });

    return res.json(updatedQueue);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Update queue error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all retry policies in organization (normally global-ish, but let's query all)
router.get('/policies', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const policies = await prisma.retryPolicy.findMany({
      orderBy: { name: 'asc' },
    });
    return res.json(policies);
  } catch (err) {
    console.error('Get policies error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create retry policy
router.post('/policies', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const policyData = RetryPolicySchema.parse(req.body);
    const policy = await prisma.retryPolicy.create({
      data: policyData,
    });
    return res.status(201).json(policy);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Create policy error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
