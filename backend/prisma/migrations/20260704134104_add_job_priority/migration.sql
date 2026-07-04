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
INSERT INTO "new_Job" ("claimedAt", "completedAt", "createdAt", "failedAt", "id", "jobType", "maxRetries", "parentJobId", "payload", "queueId", "retriesCount", "scheduledAt", "status", "updatedAt", "workerId") SELECT "claimedAt", "completedAt", "createdAt", "failedAt", "id", "jobType", "maxRetries", "parentJobId", "payload", "queueId", "retriesCount", "scheduledAt", "status", "updatedAt", "workerId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_status_scheduledAt_idx" ON "Job"("status", "scheduledAt");
CREATE INDEX "Job_queueId_idx" ON "Job"("queueId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
