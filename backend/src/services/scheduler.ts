import parser from 'cron-parser';
import prisma from '../prisma';

let cronIntervalId: NodeJS.Timeout | null = null;
let recoveryIntervalId: NodeJS.Timeout | null = null;

/**
 * Checks active ScheduledJobs and triggers jobs that are due.
 */
export async function runCronScheduler() {
  try {
    const now = new Date();
    const scheduledJobs = await prisma.scheduledJob.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
    });

    if (scheduledJobs.length === 0) return;

    for (const sched of scheduledJobs) {
      try {
        const cronInterval = parser.parseExpression(sched.cronExpression, { currentDate: now });
        const nextRunAt = cronInterval.next().toDate();

        await prisma.$transaction(async (tx) => {
          // 1. Queue a new job execution
          const job = await tx.job.create({
            data: {
              queueId: sched.queueId,
              payload: sched.jobPayload,
              jobType: sched.jobType,
              status: 'QUEUED',
            },
          });

          // 2. Update the scheduler state
          await tx.scheduledJob.update({
            where: { id: sched.id },
            data: {
              lastRunAt: now,
              nextRunAt: nextRunAt,
            },
          });

          // 3. Log the trigger event
          await tx.jobLog.create({
            data: {
              jobId: job.id,
              level: 'INFO',
              message: `Job spawned automatically from cron schedule: "${sched.name}"`,
            },
          });
        });

        console.log(`[Scheduler] Triggered scheduled job "${sched.name}" (${sched.id})`);
      } catch (err) {
        console.error(`[Scheduler] Failed to process scheduled job "${sched.name}":`, err);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error in cron scheduler run:', err);
  }
}

/**
 * Checks for workers that haven't sent a heartbeat recently (e.g. within 15 seconds)
 * and recovers any jobs that were running on them.
 */
export async function runWorkerRecovery() {
  try {
    const timeoutThreshold = new Date(Date.now() - 15 * 1000); // 15 seconds ago
    const deadWorkers = await prisma.worker.findMany({
      where: {
        status: 'ACTIVE',
        lastHeartbeatAt: { lt: timeoutThreshold },
      },
    });

    if (deadWorkers.length === 0) return;

    for (const worker of deadWorkers) {
      console.log(`[Janitor] Worker "${worker.name}" (${worker.id}) is dead (no heartbeat since ${worker.lastHeartbeatAt.toISOString()}). Recovering jobs...`);

      // 1. Mark worker as INACTIVE
      await prisma.worker.update({
        where: { id: worker.id },
        data: { status: 'INACTIVE' },
      });

      // 2. Find jobs currently claimed or running on this worker
      const stuckJobs = await prisma.job.findMany({
        where: {
          workerId: worker.id,
          status: { in: ['CLAIMED', 'RUNNING'] },
        },
        include: {
          queue: {
            include: { retryPolicy: true },
          },
        },
      });

      for (const job of stuckJobs) {
        const nextRetryCount = job.retriesCount + 1;
        const policy = job.queue.retryPolicy;
        const maxRetries = policy ? policy.maxRetries : job.maxRetries;
        const now = new Date();

        await prisma.$transaction(async (tx) => {
          // Find and close the active execution
          const runningExecution = await tx.jobExecution.findFirst({
            where: {
              jobId: job.id,
              workerId: worker.id,
              status: 'RUNNING',
            },
            orderBy: { startedAt: 'desc' },
          });

          if (runningExecution) {
            await tx.jobExecution.update({
              where: { id: runningExecution.id },
              data: {
                status: 'FAILED',
                finishedAt: now,
                durationMs: now.getTime() - runningExecution.startedAt.getTime(),
                errorMessage: `Worker crashed or heartbeat timed out.`,
              },
            });
          }

          await tx.jobLog.create({
            data: {
              jobId: job.id,
              level: 'ERROR',
              message: `Worker "${worker.name}" went offline while executing this job.`,
            },
          });

          if (nextRetryCount > maxRetries) {
            // Move to DLQ
            await tx.job.update({
              where: { id: job.id },
              data: {
                status: 'FAILED',
                failedAt: now,
                retriesCount: nextRetryCount,
              },
            });

            await tx.deadLetterJob.create({
              data: {
                jobId: job.id,
                queueId: job.queueId,
                payload: job.payload,
                jobType: job.jobType,
                errorReason: `Worker timeout. Exceeded max retries (${maxRetries}).`,
              },
            });

            await tx.jobLog.create({
              data: {
                jobId: job.id,
                level: 'ERROR',
                message: `Exceeded max retries. Moved to Dead Letter Queue (DLQ).`,
              },
            });
          } else {
            // Schedule retry
            let delaySecs = 5;
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
              where: { id: job.id },
              data: {
                status: 'SCHEDULED',
                retriesCount: nextRetryCount,
                scheduledAt,
                workerId: null,
              },
            });

            await tx.jobLog.create({
              data: {
                jobId: job.id,
                level: 'WARN',
                message: `Job rescheduled for retry #${nextRetryCount}/${maxRetries} in ${delaySecs} seconds (at ${scheduledAt.toISOString()}) due to worker failure.`,
              },
            });
          }
        });
      }
    }
  } catch (err) {
    console.error('[Janitor] Error in worker recovery run:', err);
  }
}

/**
 * Starts all background scheduler loops.
 */
export function startSchedulerServices() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (recoveryIntervalId) clearInterval(recoveryIntervalId);

  // Poll cron scheduler every 2 seconds
  cronIntervalId = setInterval(() => {
    runCronScheduler();
  }, 2000);

  // Poll worker health checker every 5 seconds
  recoveryIntervalId = setInterval(() => {
    runWorkerRecovery();
  }, 5000);

  console.log('[Scheduler] Background services (Cron & Janitor) successfully started.');
}

/**
 * Stops all background scheduler loops.
 */
export function stopSchedulerServices() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (recoveryIntervalId) clearInterval(recoveryIntervalId);
  console.log('[Scheduler] Background services stopped.');
}
