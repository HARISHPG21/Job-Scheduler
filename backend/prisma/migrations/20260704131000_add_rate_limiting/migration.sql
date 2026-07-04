-- AlterTable
ALTER TABLE "Queue" ADD COLUMN "rateLimitMax" INTEGER;
ALTER TABLE "Queue" ADD COLUMN "rateLimitWindow" INTEGER;
