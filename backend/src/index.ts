import dotenv from 'dotenv';
import { server } from './server';
import { startSchedulerServices, stopSchedulerServices } from './services/scheduler';

dotenv.config();

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Distributed Job Scheduler Server is running!     `);
  console.log(` Port: ${PORT}                                    `);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`==================================================`);

  // Start background cron scheduler and worker timeout janitor services
  startSchedulerServices();
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  console.log('Shutting down server gracefully...');
  stopSchedulerServices();
  server.close(() => {
    console.log('HTTP and WebSocket server closed.');
    process.exit(0);
  });

  // Force exit after 10s if not closed
  setTimeout(() => {
    console.error('Force shutdown triggered after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
