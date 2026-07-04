import prisma from './prisma';

async function run() {
  const users = await prisma.user.findMany();
  console.log('--- USERS IN DEV DB ---');
  users.forEach(u => {
    console.log(`User ID: ${u.id} | Email: ${u.email} | Name: ${u.name}`);
  });
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
