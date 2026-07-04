import os from 'os';
import axios from 'axios';

// CPU calculation sampler
let lastCpuSample = { idle: 0, total: 0 };

function getCpuLoad(): number {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return 0;
  
  let idle = 0;
  let total = 0;
  
  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      total += (cpu.times as any)[type];
    }
    idle += cpu.times.idle;
  });

  const diffIdle = idle - lastCpuSample.idle;
  const diffTotal = total - lastCpuSample.total;
  
  // Save current values for next measurement
  lastCpuSample = { idle, total };

  if (diffTotal === 0) return 0;
  return Math.round((1 - diffIdle / diffTotal) * 100);
}

function getMemoryUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return Math.round((used / total) * 100);
}

export class WorkerClient {
  private workerId: string;
  private apiUrl: string;
  private concurrencyLimit: number;
  private activeJobs = new Set<string>();
  private isShuttingDown = false;
  private pollTimeoutId: NodeJS.Timeout | null = null;
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private currentBackoffMs = 1000;
  private maxBackoffMs = 10000;

  constructor(workerId: string, apiUrl: string, concurrencyLimit = 3) {
    this.workerId = workerId;
    this.apiUrl = apiUrl;
    this.concurrencyLimit = concurrencyLimit;
    
    // Initial CPU sample
    getCpuLoad();
  }

  /**
   * Register worker with the server
   */
  async register(): Promise<boolean> {
    try {
      console.log(`[Worker] Registering worker "${this.workerId}" with server at ${this.apiUrl}...`);
      await axios.post(`${this.apiUrl}/workers/register`, {
        name: this.workerId,
        host: os.hostname(),
      });
      console.log(`[Worker] Successfully registered worker "${this.workerId}"`);
      return true;
    } catch (err: any) {
      console.error(`[Worker] Failed to register:`, err.message);
      return false;
    }
  }

  /**
   * Start sending heartbeats every 3 seconds
   */
  startHeartbeats() {
    this.heartbeatIntervalId = setInterval(async () => {
      try {
        await axios.post(`${this.apiUrl}/workers/heartbeat`, {
          workerId: this.workerId,
          cpuUsage: getCpuLoad(),
          ramUsage: getMemoryUsage(),
          activeJobsCount: this.activeJobs.size,
        });
      } catch (err: any) {
        console.error(`[Worker] Heartbeat failed:`, err.message);
      }
    }, 3000);
  }

  /**
   * Starts the polling loop
   */
  startPolling() {
    console.log(`[Worker] Starting polling loop. Concurrency Limit: ${this.concurrencyLimit}`);
    this.poll();
  }

  /**
   * Stop polling and heartbeats
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    console.log(`[Worker] Stopping worker "${this.workerId}" gracefully...`);
    
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
    }
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
    }

    // Wait for active jobs to finish
    if (this.activeJobs.size > 0) {
      console.log(`[Worker] Waiting for ${this.activeJobs.size} active jobs to complete...`);
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.activeJobs.size === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);
      });
    }

    console.log(`[Worker] Worker "${this.workerId}" shut down successfully.`);
  }

  private poll = async () => {
    if (this.isShuttingDown) return;

    // If concurrency limit is reached, defer polling
    if (this.activeJobs.size >= this.concurrencyLimit) {
      this.pollTimeoutId = setTimeout(this.poll, 1000);
      return;
    }

    try {
      const response = await axios.post(`${this.apiUrl}/workers/claim`, {
        workerId: this.workerId,
      });

      if (response.status === 200 && response.data) {
        // We claimed a job! Reset backoff and execute
        const { job, executionId } = response.data;
        this.currentBackoffMs = 1000;
        
        console.log(`[Worker] Claimed job ${job.id} (Type: ${job.jobType})`);
        this.activeJobs.add(job.id);
        
        // Run in background concurrently
        this.runJob(job, executionId);
      } else {
        // Empty queue, backoff
        this.currentBackoffMs = Math.min(this.currentBackoffMs * 1.5, this.maxBackoffMs);
      }
    } catch (err: any) {
      console.error(`[Worker] Error polling server:`, err.message);
      this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
    }

    // Schedule next poll
    this.pollTimeoutId = setTimeout(this.poll, this.currentBackoffMs);
  };

  private async runJob(job: any, executionId: string) {
    try {
      const payload = JSON.parse(job.payload);
      await this.sendLog(job.id, 'INFO', `Started processing task on worker "${this.workerId}"`);

      let output = '';
      if (job.jobType === 'email') {
        output = await this.executeEmail(job.id, payload);
      } else if (job.jobType === 'report') {
        output = await this.executeReport(job.id, payload);
      } else if (job.jobType === 'data_sync') {
        output = await this.executeDataSync(job.id, payload);
      } else if (job.jobType === 'db_maintenance') {
        output = await this.executeDbMaintenance(job.id, payload);
      } else {
        output = await this.executeGeneric(job.id, payload);
      }

      // Complete job on server
      await axios.post(`${this.apiUrl}/workers/complete`, {
        jobId: job.id,
        workerId: this.workerId,
        output,
      });
      console.log(`[Worker] Job ${job.id} completed successfully.`);
    } catch (err: any) {
      console.error(`[Worker] Job ${job.id} failed:`, err.message);
      // Report failure back to server
      try {
        await axios.post(`${this.apiUrl}/workers/fail`, {
          jobId: job.id,
          workerId: this.workerId,
          errorMessage: err.message || 'Unknown execution error',
        });
      } catch (failErr: any) {
        console.error(`[Worker] Failed to report failure for job ${job.id}:`, failErr.message);
      }
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private async sendLog(jobId: string, level: 'INFO' | 'WARN' | 'ERROR', message: string) {
    try {
      await axios.post(`${this.apiUrl}/workers/jobs/${jobId}/log`, { level, message });
    } catch (err: any) {
      console.error(`[Worker] Failed to send log to server:`, err.message);
    }
  }

  // Task simulation: Email
  private async executeEmail(jobId: string, payload: any): Promise<string> {
    await this.sendLog(jobId, 'INFO', `Connecting to SMTP host at mail.organization.internal...`);
    await this.sleep(1000);
    await this.sendLog(jobId, 'INFO', `Sending email body payload to target: ${payload.to || 'recipient@domain.com'}`);
    await this.sleep(1500);
    await this.sendLog(jobId, 'INFO', `Email accepted by server for delivery. Transaction ID: SMTP-MSG-${Math.floor(Math.random() * 90000) + 10000}`);
    return `Sent email successfully to ${payload.to || 'recipient@domain.com'}`;
  }

  // Task simulation: Report Generation
  private async executeReport(jobId: string, payload: any): Promise<string> {
    await this.sendLog(jobId, 'INFO', `Querying analytics data for report "${payload.reportId || 'REP-GENERIC'}"...`);
    await this.sleep(2000);
    await this.sendLog(jobId, 'INFO', `Compiling tables, markdown summaries, and chart matrices...`);
    await this.sleep(2500);
    await this.sendLog(jobId, 'INFO', `Converting report data layout to PDF document format...`);
    await this.sleep(1500);
    await this.sendLog(jobId, 'INFO', `Saved PDF binary bundle to S3 storage bucket. Link key: s3://reports/${payload.reportId || 'REP-GENERIC'}.pdf`);
    return `Generated PDF report ${payload.reportId || 'REP-GENERIC'} successfully. (Format: ${payload.format || 'PDF'})`;
  }

  // Task simulation: Data Sync (includes simulated failures!)
  private async executeDataSync(jobId: string, payload: any): Promise<string> {
    await this.sendLog(jobId, 'INFO', `Initiating data sync connection with service "${payload.service || 'Stripe'}"...`);
    await this.sleep(1500);
    
    // Simulate a random failure (15% rate) to demonstrate retries, exponential backoffs, and Dead Letter Queue!
    if (Math.random() < 0.15) {
      await this.sendLog(jobId, 'ERROR', `Network failure: API request to provider timed out after 5000ms`);
      throw new Error(`Data sync API connection failed: External provider "${payload.service || 'Stripe'}" API limit exceeded or timed out`);
    }

    await this.sendLog(jobId, 'INFO', `Syncing entity classes: ${JSON.stringify(payload.entities || ['customers', 'charges'])}`);
    await this.sleep(2000);
    await this.sendLog(jobId, 'INFO', `Processed and synchronized 142 records successfully.`);
    return `Data sync with ${payload.service || 'Stripe'} completed. Synchronized 142 entries.`;
  }

  // Task simulation: DB Maintenance
  private async executeDbMaintenance(jobId: string, payload: any): Promise<string> {
    await this.sendLog(jobId, 'INFO', `Analyzing index fragmentation tables...`);
    await this.sleep(2000);
    await this.sendLog(jobId, 'INFO', `Rebuilding cluster indices for target databases (cleanOrphans = ${payload.cleanOrphans ?? true})...`);
    await this.sleep(3000);
    return `Database maintenance: Indices successfully defragmented and vacuumed.`;
  }

  // Task simulation: Generic/Fallback
  private async executeGeneric(jobId: string, payload: any): Promise<string> {
    await this.sendLog(jobId, 'INFO', `Executing generic dummy task...`);
    await this.sleep(2000);
    return `Executed generic dummy task. Payload size: ${JSON.stringify(payload).length} bytes.`;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
