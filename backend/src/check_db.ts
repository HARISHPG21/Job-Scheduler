import prisma from './prisma';

async function run() {
  const users = await prisma.user.count();
  const orgs = await prisma.organization.count();
  const projects = await prisma.project.count();
  const queues = await prisma.queue.count();
  const jobs = await prisma.job.count();
  const dlq = await prisma.deadLetterJob.count();
  const workers = await prisma.worker.count();
  
  console.log('--- DB CHECK ---');
  console.log('Orgs count:', orgs);
  console.log('Users count:', users);
  console.log('Projects count:', projects);
  console.log('Queues count:', queues);
  console.log('Jobs count:', jobs);
  console.log('DLQ count:', dlq);
  console.log('Workers count:', workers);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
