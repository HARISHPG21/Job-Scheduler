-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeadLetterJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT,
    "queueId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "failedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorReason" TEXT NOT NULL,
    CONSTRAINT "DeadLetterJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeadLetterJob_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "Queue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DeadLetterJob" ("errorReason", "failedAt", "id", "jobId", "jobType", "payload", "queueId") SELECT "errorReason", "failedAt", "id", "jobId", "jobType", "payload", "queueId" FROM "DeadLetterJob";
DROP TABLE "DeadLetterJob";
ALTER TABLE "new_DeadLetterJob" RENAME TO "DeadLetterJob";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
