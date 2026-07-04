import prisma from './prisma';

async function run() {
  const jobs = await prisma.job.findMany({
    include: {
      queue: true,
      dlqEntries: true
    }
  });
  console.log('--- JOBS TELEMETRY ---');
  jobs.forEach(j => {
    console.log(`Job ID: ${j.id.substring(0, 8)} | Type: ${j.jobType} | Status: ${j.status} | DLQ Entries Count: ${j.dlqEntries.length}`);
  });
  
  const dlq = await prisma.deadLetterJob.findMany();
  console.log('--- DLQ ENTRIES ---');
  dlq.forEach(d => {
    console.log(`DLQ ID: ${d.id.substring(0, 8)} | JobId: ${d.jobId ? d.jobId.substring(0, 8) : 'null'} | Reason: ${d.errorReason}`);
  });
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
