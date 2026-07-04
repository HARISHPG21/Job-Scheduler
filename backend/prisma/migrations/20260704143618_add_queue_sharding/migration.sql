-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queueId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "payload" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "shardId" INTEGER NOT NULL DEFAULT 0,
    "retriesCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" DATETIME,
    "claimedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "workerId" TEXT,
    "parentJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "Queue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("claimedAt", "completedAt", "createdAt", "failedAt", "id", "jobType", "maxRetries", "parentJobId", "payload", "priority", "queueId", "retriesCount", "scheduledAt", "status", "updatedAt", "workerId") SELECT "claimedAt", "completedAt", "createdAt", "failedAt", "id", "jobType", "maxRetries", "parentJobId", "payload", "priority", "queueId", "retriesCount", "scheduledAt", "status", "updatedAt", "workerId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_status_scheduledAt_idx" ON "Job"("status", "scheduledAt");
CREATE INDEX "Job_queueId_idx" ON "Job"("queueId");
CREATE TABLE "new_Queue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 5,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "rateLimitMax" INTEGER,
    "rateLimitWindow" INTEGER,
    "retryPolicyId" TEXT,
    "shardsCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Queue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Queue_retryPolicyId_fkey" FOREIGN KEY ("retryPolicyId") REFERENCES "RetryPolicy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Queue" ("concurrencyLimit", "createdAt", "id", "isPaused", "name", "priority", "projectId", "rateLimitMax", "rateLimitWindow", "retryPolicyId", "updatedAt") SELECT "concurrencyLimit", "createdAt", "id", "isPaused", "name", "priority", "projectId", "rateLimitMax", "rateLimitWindow", "retryPolicyId", "updatedAt" FROM "Queue";
DROP TABLE "Queue";
ALTER TABLE "new_Queue" RENAME TO "Queue";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
