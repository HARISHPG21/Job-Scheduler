import { WorkerClient } from './worker';

// Simple command-line argument parser
const args = process.argv.slice(2);
let workerName = `Worker-${process.pid || Math.floor(Math.random() * 1000)}`;
let concurrency = 3;
let apiUrl = 'http://localhost:5000/api';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--name' || arg === '-n') {
    workerName = args[i + 1];
    i++;
  } else if (arg === '--concurrency' || arg === '-c') {
    concurrency = parseInt(args[i + 1], 10) || 3;
    i++;
  } else if (arg === '--url' || arg === '-u') {
    apiUrl = args[i + 1];
    i++;
  }
}

async function start() {
  console.log(`==================================================`);
  console.log(` Starting Worker Service Node                     `);
  console.log(` Name: ${workerName}                              `);
  console.log(` Server URL: ${apiUrl}                            `);
  console.log(` Concurrency limit: ${concurrency}                `);
  console.log(`==================================================`);

  const worker = new WorkerClient(workerName, apiUrl, concurrency);

  let registered = false;
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    registered = await worker.register();
    if (registered) break;
    console.log(`[Worker] Server not ready (attempt ${attempt}/${maxAttempts}). Retrying in 2 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!registered) {
    console.error('[Worker] Fatal: Could not register with the API server after multiple attempts. Exiting.');
    process.exit(1);
  }

  worker.startHeartbeats();
  worker.startPolling();

  // Handle graceful shutdown signals
  const shutdown = async () => {
    console.log('\n[Worker] Received shutdown signal.');
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('[Worker] Startup error:', err);
  process.exit(1);
});
