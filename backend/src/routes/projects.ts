import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const ProjectSchema = z.object({
  name: z.string().min(2),
});

// Get all projects for the organization
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projects = await prisma.project.findMany({
      where: { organizationId: req.organizationId },
      include: {
        _count: {
          select: { queues: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(projects);
  } catch (err) {
    console.error('Get projects error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create project
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = ProjectSchema.parse(req.body);
    const project = await prisma.project.create({
      data: {
        name,
        organizationId: req.organizationId!,
      },
    });
    return res.status(201).json(project);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Create project error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
