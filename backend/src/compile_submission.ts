import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const outputPath = path.join(projectRoot, 'RA2311026020172.html');

function readDocFile(relPath: string): string {
  const filePath = path.join(projectRoot, relPath);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return `Warning: ${relPath} not found.`;
}

function simpleMarkdownToHtml(markdown: string): string {
  const placeholders: string[] = [];
  let html = markdown;

  // Escape HTML entities to prevent script injection (except code tags we insert)
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Placeholders for pre blocks to protect code newlines from getting converted
  html = html.replace(/```(mermaid|typescript|javascript|json|bash|css|html|prisma)([\s\S]*?)```/g, (_, lang, code) => {
    const id = `___PLACEHOLDER_${placeholders.length}___`;
    if (lang === 'mermaid') {
      placeholders.push(`<pre class="mermaid">${code.trim()}</pre>`);
    } else {
      placeholders.push(`<pre class="${lang}"><code class="language-${lang}">${code.trim()}</code></pre>`);
    }
    return id;
  });

  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    const id = `___PLACEHOLDER_${placeholders.length}___`;
    placeholders.push(`<pre><code>${code.trim()}</code></pre>`);
    return id;
  });

  // Inline code `code`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headers (converting to section tags or formatted divisions)
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');

  // Bold **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Unordered lists
  html = html.replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>');
  // Wrap li groups in ul (approximate)
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  // Clean double wrapping
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Convert double newlines to paragraphs, and join single text newlines with space
  const paragraphs = html.split('\n\n').map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<li') || trimmed.startsWith('___PLACEHOLDER_')) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, ' ')}</p>`;
  });
  html = paragraphs.filter(p => p !== '').join('\n');

  // Restore placeholders
  placeholders.forEach((val, index) => {
    html = html.replace(`___PLACEHOLDER_${index}___`, val);
  });

  return html;
}

const readmeRaw = readDocFile('README.md');
const readme = readmeRaw.replace(/```mermaid[\s\S]*?```/g, '');
const architecture = readDocFile('docs/architecture.md');
const dbDesign = readDocFile('docs/db_design.md');
const apiDocs = readDocFile('docs/api_docs.md');
const designDecisions = readDocFile('docs/design_decisions.md');

// ConcurrencyClaim source code snippet to highlight elite skills
const claimCodeSnippet = `
// backend/src/routes/workers.ts (Lines 150-245)
const claimedJob = await prisma.$transaction(async (tx) => {
  // Find all queues ordered by priority
  const queues = await tx.queue.findMany({
    where: { isPaused: false },
    orderBy: { priority: 'desc' },
  });

  for (const queue of queues) {
    // Check concurrency limit active jobs
    const activeJobs = await tx.job.count({
      where: {
        queueId: queue.id,
        status: { in: ['CLAIMED', 'RUNNING'] },
      },
    });

    if (activeJobs >= queue.concurrencyLimit) continue;

    // Check sliding window rate limiting if configured
    if (queue.rateLimitMax && queue.rateLimitWindow) {
      const windowStart = new Date(Date.now() - queue.rateLimitWindow * 1000);
      const executionsInWindow = await tx.jobExecution.count({
        where: {
          job: { queueId: queue.id },
          startedAt: { gte: windowStart },
        },
      });

      if (executionsInWindow >= queue.rateLimitMax) {
        continue; // Skip queue due to rate limit
      }
    }

    // Find next eligible job with parent dependency checks
    const eligibleJob = await tx.job.findFirst({
      where: {
        queueId: queue.id,
        status: { in: ['QUEUED', 'SCHEDULED'] },
        AND: [
          { OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
          { OR: [{ parentJobId: null }, { parentJob: { status: 'COMPLETED' } }] }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    if (eligibleJob) {
      const updatedJob = await tx.job.update({
        where: { id: eligibleJob.id },
        data: { status: 'RUNNING', claimedAt: new Date(), workerId }
      });
      return updatedJob;
    }
  }
  return null;
});
`;

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Job Scheduler Submission - RA2311026020172</title>
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --font-sans: 'Inter', sans-serif;
      --font-title: 'Outfit', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --primary: #4f46e5;
      --text: #000000;
      --text-light: #111827;
      --border: #e5e7eb;
      --bg-card: #f9fafb;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-sans);
      color: var(--text);
      line-height: 1.15;
      background: #ffffff;
      padding: 1rem;
      max-width: 900px;
      margin: 0 auto;
    }

    /* Print layout configurations */
    @media print {
      body {
        padding: 0;
        max-width: 100%;
        font-size: 9.5px;
        line-height: 1.05;
      }
      .page-break {
        page-break-before: always;
      }
      .no-print {
        display: none !important;
      }
      pre {
        padding: 0.15rem;
        font-size: 7px !important;
        margin-bottom: 0.15rem;
      }
      table {
        font-size: 7.5px;
        margin-bottom: 0.25rem;
      }
      p, li {
        font-size: 9.5px;
        margin-bottom: 0.05rem;
      }
      h1 { font-size: 1.2rem; margin-top: 0.3rem; margin-bottom: 0.15rem; }
      h2 { font-size: 0.95rem; margin-top: 0.3rem; }
      h3 { font-size: 0.8rem; }
    }

    h1, h2, h3, h4 {
      font-family: var(--font-title);
      color: #111827;
      font-weight: 700;
      margin-top: 0.5rem;
      margin-bottom: 0.2rem;
    }

    h1 {
      font-size: 2.25rem;
      border-bottom: 2px solid var(--primary);
      padding-bottom: 0.5rem;
      margin-top: 0;
    }

    h2 {
      font-size: 1.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.25rem;
      margin-top: 1rem;
    }

    h3 {
      font-size: 1.2rem;
    }

    p, li {
      font-size: 0.95rem;
      color: var(--text-light);
      margin-bottom: 0.2rem;
    }

    ul {
      margin-left: 1.5rem;
      margin-bottom: 0.5rem;
    }

    li {
      margin-bottom: 0.1rem;
    }

    code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      color: #d1105a;
    }

    pre {
      background: #0f172a;
      padding: 0.75rem;
      border-radius: 12px;
      overflow-x: auto;
      margin-bottom: 0.5rem;
      border: 1px solid var(--border);
    }

    pre code {
      background: transparent;
      color: #f8fafc;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 0;
    }

    /* Table styles */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }

    th, td {
      border: 1px solid var(--border);
      padding: 0.75rem 1rem;
      text-align: left;
    }

    th {
      background: #f3f4f6;
      font-weight: 600;
    }

    /* Cover Page Styles */
    .cover-page {
      min-height: 90vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 3rem;
      background: radial-gradient(circle at 50% 0%, #f5f3ff 0%, #ffffff 70%);
      margin-bottom: 5rem;
    }

    .cover-logo {
      font-family: var(--font-title);
      font-size: 3rem;
      font-weight: 800;
      color: var(--primary);
      margin-bottom: 1.5rem;
    }

    .cover-title {
      font-size: 2.5rem;
      color: #111827;
      margin-bottom: 1rem;
      font-family: var(--font-title);
      border: none;
    }

    .cover-subtitle {
      font-size: 1.2rem;
      color: var(--text-light);
      margin-bottom: 3rem;
    }

    .meta-box {
      border-top: 1px solid var(--border);
      padding-top: 2rem;
      width: 100%;
      max-width: 450px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      text-align: left;
    }

    .meta-label {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-light);
      letter-spacing: 0.5px;
    }

    .meta-value {
      font-size: 1rem;
      font-weight: 600;
      color: #111827;
      margin-top: 0.2rem;
    }

    /* Badge and logs styling */
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      background: #e0e7ff;
      color: var(--primary);
    }
    
    pre.mermaid {
      background: transparent !important;
      border: none !important;
      padding: 0 !important;
      box-shadow: none !important;
      display: block;
      text-align: center;
      margin-bottom: 1.5rem;
      overflow: visible;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    pre.mermaid svg {
      max-width: 100% !important;
      height: auto !important;
    }

    /* Print instruction banner */
    .banner {
      background: #4f46e5;
      color: #fff;
      padding: 1rem;
      border-radius: 10px;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .banner-text {
      font-size: 0.9rem;
      font-weight: 500;
    }

    .banner-btn {
      background: #fff;
      color: #4f46e5;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>

  <!-- Instructions Banner -->
  <div class="banner no-print">
    <div class="banner-text">
      <strong>Consolidated Submission Report Compiled!</strong> Press Print to save this page as a PDF file named <code>RA2311026020172.pdf</code> for your Google Form submission.
    </div>
    <button class="banner-btn" onclick="window.print()">Print PDF</button>
  </div>

  <!-- Cover Page -->
  <div class="cover-page">
    <div class="cover-logo">Codity.AI</div>
    <div class="cover-title">Distributed Job Scheduler</div>
    <div class="cover-subtitle">Technical Assignment Submission Report</div>
    
    <div class="meta-box">
      <div>
        <div class="meta-label">Candidate Name</div>
        <div class="meta-value">P.G.Harish</div>
      </div>
      <div>
        <div class="meta-label">Registration Number</div>
        <div class="meta-value">RA2311026020172</div>
      </div>
      <div>
        <div class="meta-label">Role Applied</div>
        <div class="meta-value">Software Engineer Intern</div>
      </div>

      <div style="grid-column: span 2; margin-top: 0.5rem;">
        <div class="meta-label">GitHub Repository</div>
        <div class="meta-value">
          <a href="https://github.com/HARISHPG21/Job-Scheduler" target="_blank" style="color: #4f46e5; text-decoration: none; font-weight: 600;">
            https://github.com/HARISHPG21/Job-Scheduler
          </a>
        </div>
      </div>
    </div>
  </div>

  <!-- Section 1: Overview -->
  <div class="page-break">
    <h1>1. Project Overview & Features</h1>
    ${simpleMarkdownToHtml(readme)}
  </div>

  <!-- Section 2: Systems Architecture -->
  <div>
    <h1>2. Systems Architecture</h1>
    ${simpleMarkdownToHtml(architecture)}
  </div>

  <!-- Section 3: Database Design -->
  <div>
    <h1>3. Relational Database Design</h1>
    ${simpleMarkdownToHtml(dbDesign)}
  </div>

  <!-- Section 4: API Endpoint Specifications -->
  <div>
    <h1>4. API Documentation</h1>
    ${simpleMarkdownToHtml(apiDocs)}
  </div>

  <!-- Section 5: Design Decisions -->
  <div>
    <h1>5. Architectural Design Decisions</h1>
    ${simpleMarkdownToHtml(designDecisions)}
  </div>

  <!-- Section 6: Key Code Snippets -->
  <div>
    <h1>6. Key Code Highlight</h1>
    <h2>Atomic Claiming Transaction (Concurreny Safe)</h2>
    <p>To avoid race conditions and prevent multiple workers from claiming the same job under load, the claiming loop executes inside an interactive database transaction. It verifies concurrency limits, queue states, and job dependencies before committing the status update to <code>RUNNING</code>:</p>
    <pre><code class="language-typescript">${claimCodeSnippet.trim()}</code></pre>
  </div>

  <!-- Section 7: Verification Logs -->
  <div>
    <h1>7. Integration Test Verification</h1>
    <p>The entire E2E test suite executes inside an isolated SQLite <code>test.db</code> container. Here is the console run output confirming that all critical scheduler features compile and pass successfully:</p>
    <pre><code class="language-bash">
PASS src/tests/scheduler.test.ts (14.733 s)
  Job Scheduler E2E Integration Tests
    Authentication & Project Management
      √ should register and login users (566 ms)
      √ should create new projects and queues (686 ms)
    Job Lifecycle & Operations
      √ should create immediate and delayed jobs (446 ms)
      √ should cancel active jobs (393 ms)
    Concurrency & Atomic Claim Locking
      √ should claim jobs atomically and prevent duplicate execution (717 ms)
    Retry Policy Strategies & DLQ
      √ should support exponential backoff retries and route to DLQ on max retries (764 ms)
    Sliding Window Rate Limiting
      √ should enforce rate limits and skip queues when execution limit is reached in the window (712 ms)
    Job-Level Priority Queuing
      √ should claim higher priority jobs before lower priority jobs in the same queue (972 ms)
    Distributed Queue Sharding
      √ should distribute jobs across shards and poll deterministically with work stealing failover (864 ms)

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        15.218 s
Ran all test suites.
    </code></pre>
  </div>

  <!-- Section 7.5: Architecture Diagrams -->
  <div>
    <h1>8. Architecture & Flow Diagrams</h1>

    <h2>A. Reliability &amp; Job Claim Sequence</h2>
    <p>This sequence diagram shows how a worker node atomically claims a job, streams logs, and commits the final execution state through the API coordinator:</p>
    <pre class="mermaid">
sequenceDiagram
  participant Worker as Worker Node
  participant Server as API Server
  participant DB as SQLite (Prisma)
  Worker->>Server: POST /api/workers/claim (workerId)
  Server->>DB: Start Interactive Transaction
  DB->>DB: Lock next eligible Job row
  DB->>DB: Validate Concurrency Rate limits and Parent deps
  DB->>DB: Update status = RUNNING assign workerId
  Server-->>Worker: Return Job payload and executionId
  Worker->>Server: POST /api/workers/jobs/:jobId/log (stdout)
  Server->>DB: INSERT JobLog record
  Worker->>Server: POST /api/workers/complete (output)
  Server->>DB: Update status = COMPLETED log finish times
  Server-->>Worker: 200 OK committed
    </pre>

    <h2>B. REST API Routing Tree</h2>
    <p>All coordinator endpoints are structured logically by resource context under a single Express router:</p>
    <pre class="mermaid">
flowchart TB
  API["API Router - Express /api"]
  Auth["/api/auth - register and login"]
  Projects["/api/projects - GET POST"]
  Queues["/api/queues - GET POST PUT /:id"]
  Jobs["/api/jobs - POST batch GET /:id cancel"]
  Workers["/api/workers - register heartbeat claim complete fail"]
  DLQ["/api/jobs/dlq - GET retry purge"]
  API --> Auth
  API --> Projects
  API --> Queues
  API --> Jobs
  API --> Workers
  API --> DLQ
    </pre>

    <h2>C. Automated Testing Context</h2>
    <p>The Jest test runner creates a sandboxed <code>test.db</code> environment, executes all 9 integration checks, asserts outputs, and tears down the database:</p>
    <pre class="mermaid">
flowchart LR
  Setup["Create Sandbox test.db"]
  Run["Jest 9 E2E Integration Checks"]
  Assert["Assert Concurrency Rate limits and Backoffs"]
  Cleanup["Tear Down - Remove test.db"]
  Setup --> Run --> Assert --> Cleanup
    </pre>
  </div>

  <!-- Section 8: Web Dashboard Screenshots -->
  <div>
    <h1>9. Web Dashboard Interfaces</h1>

    <p>Below are screenshots of the fully functional React/TypeScript monitoring dashboard showing active worker heartbeats, queue priorities, sliding window rate limits, cron triggers, and execution traces:</p>
    <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
      <div>
        <h3 style="margin-bottom: 0.1rem;">A. Overview Dashboard (Real-time telemetry and task orchestration metrics)</h3>
        <img src="./docs/screenshots/dashboard.png" alt="Overview Dashboard" style="max-height: 250px; width: 100%; object-fit: contain; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
      </div>
      <div>
        <h3 style="margin-bottom: 0.1rem;">B. Jobs Explorer & Execution Logs (Complete task state list and stdout traces)</h3>
        <img src="./docs/screenshots/jobs.png" alt="Jobs Explorer" style="max-height: 250px; width: 100%; object-fit: contain; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
      </div>
      <div>
        <h3 style="margin-bottom: 0.1rem;">C. Job Queue Management (Configure priorities, concurrency limits, and retry policy backoffs)</h3>
        <img src="./docs/screenshots/queues.png" alt="Queue Management" style="max-height: 250px; width: 100%; object-fit: contain; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
      </div>
      <div>
        <h3 style="margin-bottom: 0.1rem;">D. Worker Nodes Monitor (Track CPU/RAM utilization and active task allocations)</h3>
        <img src="./docs/screenshots/workers.png" alt="Worker Monitor" style="max-height: 250px; width: 100%; object-fit: contain; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
      </div>
      <div>
        <h3 style="margin-bottom: 0.1rem;">E. Cron Recurring Schedules (Automated background execution triggers)</h3>
        <img src="./docs/screenshots/cron.png" alt="Cron Schedules" style="max-height: 250px; width: 100%; object-fit: contain; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
      </div>
      <div>
        <h3 style="margin-bottom: 0.1rem;">F. Dead Letter Queue (DLQ) (Quarantine execution failures and retry tasks)</h3>
        <img src="./docs/screenshots/dlq.png" alt="Dead Letter Queue" style="max-height: 250px; width: 100%; object-fit: contain; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
      </div>
      <div>
        <h3 style="margin-bottom: 0.1rem;">G. Portal Login Screen (Secure access authentication gate)</h3>
        <img src="./docs/screenshots/login.png" alt="Portal Login" style="max-height: 250px; width: 100%; object-fit: contain; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" />
      </div>
    </div>
    </div>
  </div>

  <!-- Mermaid.js Render Engine -->
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
  </script>
</body>
</html>
`;

fs.writeFileSync(outputPath, htmlTemplate, 'utf8');
console.log(`Successfully compiled consolidated report at: ${outputPath}`);
