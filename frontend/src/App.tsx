import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Layers,
  Cpu,
  Clock,
  AlertOctagon,
  LogOut,
  Plus,
  Search,
  RefreshCw,
  X,
  Pause,
  Play,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Terminal as TerminalIcon,
  Trash2,
  Menu
} from 'lucide-react';

const API_BASE = '/api';

export default function App() {
  // Authentication State
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any>(JSON.parse(localStorage.getItem('user') || 'null'));
  const [org, setOrg] = useState<any>(JSON.parse(localStorage.getItem('org') || 'null'));
  
  // Auth Form State
  const [isRegister, setIsRegister] = useState(false);
  const [authEmail, setAuthEmail] = useState('admin@acme.com');
  const [authPassword, setAuthPassword] = useState('password123');
  const [authName, setAuthName] = useState('');
  const [authOrgName, setAuthOrgName] = useState('');
  const [authError, setAuthError] = useState('');

  // Active View Tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'queues' | 'jobs' | 'workers' | 'schedules' | 'dlq'>('dashboard');

  // Mobile navigation drawer state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Automatically close sidebar when tab changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [activeTab]);

  // Metrics Data
  const [metrics, setMetrics] = useState<any>({
    statusCounts: { QUEUED: 0, SCHEDULED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 },
    queueStats: [],
    workerStats: { active: 0, inactive: 0 },
    throughput: [],
    avgDurationMs: 0
  });

  // Data Lists & Loading States
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [queues, setQueues] = useState<any[]>([]);
  const [retryPolicies, setRetryPolicies] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [scheduledJobs, setScheduledJobs] = useState<any[]>([]);
  const [dlqJobs, setDlqJobs] = useState<any[]>([]);
  
  // Jobs Explorer states
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobPage, setJobPage] = useState(1);
  const [jobTotalPages, setJobTotalPages] = useState(1);
  const [jobFilterStatus, setJobFilterStatus] = useState('');
  const [jobFilterQueue, setJobFilterQueue] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [loadingJobs, setLoadingJobs] = useState(false);

  // Selected Job Details for Modal (Log Viewer)
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [selectedJobLogs, setSelectedJobLogs] = useState<any[]>([]);
  const [selectedJobExecutions, setSelectedJobExecutions] = useState<any[]>([]);
  const [pollLogsActive, setPollLogsActive] = useState(false);

  // Modals state
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [showJobModal, setShowJobModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [queueModalName, setQueueModalName] = useState('');
  const [queueModalPrio, setQueueModalPrio] = useState(1);
  const [queueModalLimit, setQueueModalLimit] = useState(5);
  const [queueModalPolicy, setQueueModalPolicy] = useState('');
  const [queueModalRateMax, setQueueModalRateMax] = useState<string>('');
  const [queueModalRateWindow, setQueueModalRateWindow] = useState<string>('');
  const [queueModalShards, setQueueModalShards] = useState<number>(1);
  
  const [jobModalQueue, setJobModalQueue] = useState('');
  const [jobModalType, setJobModalType] = useState('email');
  const [jobModalPayload, setJobModalPayload] = useState('{\n  "to": "customer@domain.com",\n  "subject": "System Alert",\n  "body": "Your queued report has generated."\n}');
  const [jobModalDelay, setJobModalDelay] = useState(0);
  const [jobModalCron, setJobModalCron] = useState('');
  const [jobModalCronName, setJobModalCronName] = useState('');
  const [jobModalParentId, setJobModalParentId] = useState('');
  const [jobModalIsBatch, setJobModalIsBatch] = useState(false);
  const [jobModalBatchCount, setJobModalBatchCount] = useState(5);
  const [jobModalPriority, setJobModalPriority] = useState<number>(1);

  const [policyModalName, setPolicyModalName] = useState('');
  const [policyModalStrategy, setPolicyModalStrategy] = useState<'FIXED' | 'LINEAR' | 'EXPONENTIAL'>('EXPONENTIAL');
  const [policyModalDelay, setPolicyModalDelay] = useState(5);
  const [policyModalRetries, setPolicyModalRetries] = useState(3);
  const [policyModalMultiplier, setPolicyModalMultiplier] = useState(2.0);

  // WS and Polling Refs
  const wsRef = useRef<WebSocket | null>(null);

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('org');
    setToken(null);
    setUser(null);
    setOrg(null);
    if (wsRef.current) wsRef.current.close();
  };

  // Auth Submit
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const body = isRegister
        ? { email: authEmail, password: authPassword, name: authName, organizationName: authOrgName }
        : { email: authEmail, password: authPassword };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('org', JSON.stringify(data.organization));
      
      setToken(data.token);
      setUser(data.user);
      setOrg(data.organization);
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  // Fetch basic lists
  const fetchProjects = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        if (data.length > 0 && !selectedProjectId) {
          setSelectedProjectId(data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchQueues = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/queues`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setQueues(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRetryPolicies = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/queues/policies`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRetryPolicies(data);
        if (data.length > 0) {
          setQueueModalPolicy(data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchWorkers = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/workers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setWorkers(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchScheduledJobs = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/scheduled`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setScheduledJobs(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDlqJobs = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/dlq`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDlqJobs(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchJobs = async () => {
    if (!token) return;
    setLoadingJobs(true);
    try {
      let query = `?page=${jobPage}&limit=12`;
      if (jobFilterStatus) query += `&status=${jobFilterStatus}`;
      if (jobFilterQueue) query += `&queueId=${jobFilterQueue}`;
      if (jobSearch) query += `&search=${encodeURIComponent(jobSearch)}`;

      const res = await fetch(`${API_BASE}/jobs${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs);
        setJobTotalPages(data.pagination.totalPages);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingJobs(false);
    }
  };

  // Fetch metrics manually (fallback / initial)
  const fetchMetrics = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/metrics`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Poll job logs when detailed modal is open
  const fetchJobDetails = async (jobId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedJob(data);
        setSelectedJobLogs(data.logs);
        setSelectedJobExecutions(data.executions);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Triggered when active tab changes
  useEffect(() => {
    if (!token) return;
    fetchProjects();
    fetchQueues();
    fetchRetryPolicies();
    
    if (activeTab === 'dashboard') {
      fetchMetrics();
    } else if (activeTab === 'queues') {
      fetchQueues();
    } else if (activeTab === 'jobs') {
      fetchJobs();
      fetchQueues();
    } else if (activeTab === 'workers') {
      fetchWorkers();
    } else if (activeTab === 'schedules') {
      fetchScheduledJobs();
    } else if (activeTab === 'dlq') {
      fetchDlqJobs();
    }
  }, [activeTab, token, jobPage, jobFilterStatus, jobFilterQueue, jobSearch]);

  // Establish WebSocket connection for live metrics updates
  useEffect(() => {
    if (!token) return;

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws`;
    
    const connectWS = () => {
      console.log('[WS] Connecting to live metrics socket...');
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log('[WS] Socket connected. Subscribing...');
        socket.send(JSON.stringify({ type: 'subscribe', token }));
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'metrics') {
            setMetrics(payload.data);
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      socket.onclose = () => {
        console.log('[WS] Socket closed. Reconnecting in 5 seconds...');
        setTimeout(() => {
          if (token) connectWS();
        }, 5000);
      };

      socket.onerror = (err) => {
        console.error('[WS] Socket error:', err);
      };
    };

    connectWS();

    // Fallback polling loop (every 3 seconds) in case WS fails or updates slower
    const fallbackInterval = setInterval(() => {
      fetchMetrics();
      // Periodically update active status lists depending on selected views
      if (activeTab === 'workers') fetchWorkers();
      if (activeTab === 'queues') fetchQueues();
    }, 3000);

    return () => {
      if (wsRef.current) wsRef.current.close();
      clearInterval(fallbackInterval);
    };
  }, [token, activeTab]);

  // Log poller when log modal is open
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (selectedJob && pollLogsActive) {
      intervalId = setInterval(() => {
        fetchJobDetails(selectedJob.id);
        // If job is finished running, stop polling logs
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(selectedJob.status)) {
          setPollLogsActive(false);
        }
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [selectedJob, pollLogsActive]);

  // Actions
  const handleCreateQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedProjectId) return;
    try {
      const res = await fetch(`${API_BASE}/queues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: queueModalName,
          projectId: selectedProjectId,
          priority: queueModalPrio,
          concurrencyLimit: queueModalLimit,
          retryPolicyId: queueModalPolicy || undefined,
          rateLimitMax: queueModalRateMax !== '' ? parseInt(queueModalRateMax) : null,
          rateLimitWindow: queueModalRateWindow !== '' ? parseInt(queueModalRateWindow) : null,
          shardsCount: queueModalShards,
        })
      });

      if (res.ok) {
        setShowQueueModal(false);
        setQueueModalName('');
        setQueueModalRateMax('');
        setQueueModalRateWindow('');
        setQueueModalShards(1);
        fetchQueues();
        fetchMetrics();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateRetryPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/queues/policies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: policyModalName,
          strategy: policyModalStrategy,
          baseDelaySecs: policyModalDelay,
          maxRetries: policyModalRetries,
          multiplier: policyModalMultiplier
        })
      });

      if (res.ok) {
        const newPolicy = await res.json();
        setRetryPolicies((prev) => [...prev, newPolicy]);
        setQueueModalPolicy(newPolicy.id);
        setShowPolicyModal(false);
        setPolicyModalName('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    try {
      let endpoint = '/jobs';
      let body: any = {};

      if (jobModalIsBatch) {
        endpoint = '/jobs/batch';
        const batchJobs = Array.from({ length: jobModalBatchCount }).map((_, index) => {
          const parsed = JSON.parse(jobModalPayload);
          parsed.batchIndex = index + 1;
          return {
            payload: JSON.stringify(parsed),
            delaySecs: jobModalDelay > 0 ? jobModalDelay : undefined,
            parentJobId: jobModalParentId || undefined
          };
        });

        body = {
          queueId: jobModalQueue,
          jobType: jobModalType,
          jobs: batchJobs
        };
      } else {
        body = {
          queueId: jobModalQueue,
          payload: jobModalPayload,
          jobType: jobModalType,
          delaySecs: jobModalDelay > 0 ? jobModalDelay : undefined,
          cronExpression: jobModalCron || undefined,
          cronName: jobModalCronName || undefined,
          parentJobId: jobModalParentId || undefined,
          priority: jobModalPriority
        };
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        setShowJobModal(false);
        setJobModalPriority(1);
        fetchJobs();
        fetchScheduledJobs();
        fetchMetrics();
      } else {
        const errorData = await res.json();
        alert(`Error spawning job: ${errorData.error}`);
      }
    } catch (err: any) {
      alert(`Invalid JSON payload format: ${err.message}`);
    }
  };

  const toggleQueuePause = async (queueId: string, isPaused: boolean) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/queues/${queueId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isPaused: !isPaused })
      });
      if (res.ok) {
        fetchQueues();
        fetchMetrics();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerRetryJob = async (jobId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchJobs();
        fetchDlqJobs();
        fetchMetrics();
        if (selectedJob && selectedJob.id === jobId) {
          fetchJobDetails(jobId);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerCancelJob = async (jobId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchJobs();
        fetchMetrics();
        if (selectedJob && selectedJob.id === jobId) {
          fetchJobDetails(jobId);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerRetryDlqEntry = async (dlqId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/dlq/${dlqId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchDlqJobs();
        fetchJobs();
        fetchMetrics();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDeleteDlqEntry = async (dlqId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/dlq/${dlqId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchDlqJobs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDlqPurge = async () => {
    if (!token || !confirm('Are you sure you want to purge all Dead Letter Queue entries?')) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/dlq/purge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchDlqJobs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDlqRetryAll = async () => {
    if (!token || !confirm('Are you sure you want to retry all DLQ entries?')) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/dlq/retry-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchDlqJobs();
        fetchJobs();
        fetchMetrics();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDeleteScheduled = async (schedId: string) => {
    if (!token || !confirm('Delete this recurring schedule?')) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/scheduled/${schedId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchScheduledJobs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Open Log Modal helper
  const openJobLogDetails = (job: any) => {
    setSelectedJob(job);
    setSelectedJobLogs([]);
    setSelectedJobExecutions([]);
    setShowJobModal(false);
    fetchJobDetails(job.id);
    setPollLogsActive(true);
  };

  // Unauthenticated screen
  if (!token) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo">
              <Sparkles size={48} />
            </div>
            <h2 className="auth-title">Job Scheduler</h2>
            <p className="auth-subtitle">
              {isRegister ? 'Create a multi-tenant workspace account' : 'Log in to your scheduler organization'}
            </p>
          </div>

          <form onSubmit={handleAuthSubmit}>
            {isRegister && (
              <>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="Jane Doe"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Organization Name</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="Acme Logistics Ltd"
                    value={authOrgName}
                    onChange={(e) => setAuthOrgName(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                required
                className="form-input"
                placeholder="admin@acme.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                required
                className="form-input"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>

            {authError && (
              <div className="badge danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1.25rem', justifyContent: 'center' }}>
                <AlertTriangle size={16} />
                {authError}
              </div>
            )}

            <button type="submit" className="btn-primary">
              {isRegister ? 'Register Account' : 'Sign In'}
            </button>
          </form>

          <div className="auth-switch">
            {isRegister ? 'Already have an organization?' : 'Need a new sandbox organization?'}
            <span className="auth-link" onClick={() => { setIsRegister(!isRegister); setAuthError(''); }}>
              {isRegister ? 'Log in here' : 'Register here'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard metrics helpers
  const totalJobs = Object.values(metrics.statusCounts).reduce((a: any, b: any) => a + b, 0) as number;
  const activeQueuesCount = metrics.queueStats.length;
  const activeWorkersCount = metrics.workerStats?.active || 0;

  return (
    <div className="app-container">
      {/* Mobile Top Header */}
      <div className="mobile-header">
        <button className="hamburger-btn" onClick={() => setSidebarOpen(true)}>
          <Menu size={20} />
        </button>
        <span className="mobile-brand-text">Scheduler</span>
        <div style={{ width: 34 }}></div> {/* spacer */}
      </div>

      {/* Sidebar Backdrop Overlay */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <Activity className="brand-icon" size={24} />
          <span className="brand-text">Job Scheduler</span>
        </div>

        <nav>
          <ul className="nav-list">
            <li className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('dashboard')}>
                <Activity size={18} />
                Overview Dashboard
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'queues' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('queues')}>
                <Layers size={18} />
                Job Queues ({activeQueuesCount})
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'jobs' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('jobs')}>
                <Clock size={18} />
                Jobs Explorer ({totalJobs})
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'workers' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('workers')}>
                <Cpu size={18} />
                Worker Nodes ({activeWorkersCount})
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'schedules' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('schedules')}>
                <Calendar size={18} />
                Cron Schedules
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'dlq' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('dlq')}>
                <AlertOctagon size={18} />
                Dead Letter Queue ({dlqJobs.length})
              </button>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">
              {user.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="user-info">
              <span className="user-name">{user.name}</span>
              <span className="user-org">{org.name}</span>
            </div>
          </div>
          <button className="btn-logout" onClick={handleLogout}>
            <LogOut size={14} />
            Logout Session
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="page-header">
          <div className="page-title-container">
            <h1>
              {activeTab === 'dashboard' && 'Overview Dashboard'}
              {activeTab === 'queues' && 'Job Queue Management'}
              {activeTab === 'jobs' && 'Jobs & Execution Logs'}
              {activeTab === 'workers' && 'Worker Nodes Monitor'}
              {activeTab === 'schedules' && 'Cron Recurring Schedules'}
              {activeTab === 'dlq' && 'Dead Letter Queue (DLQ)'}
            </h1>
            <p>
              {activeTab === 'dashboard' && 'Real-time telemetry and task orchestration health.'}
              {activeTab === 'queues' && 'Configure priorities, concurrency limits, and retry delays.'}
              {activeTab === 'jobs' && 'Inspect, retry, cancel, or trace complete task execution logs.'}
              {activeTab === 'workers' && 'Track online worker heartbeats, load indices, and CPU/RAM usage.'}
              {activeTab === 'schedules' && 'Automated background execution patterns and recurring triggers.'}
              {activeTab === 'dlq' && 'Aborted permanent job failures isolated for manual intervention.'}
            </p>
          </div>

          <div className="flex-group">
            <button className="btn-secondary" onClick={() => {
              if (activeTab === 'dashboard') fetchMetrics();
              if (activeTab === 'queues') fetchQueues();
              if (activeTab === 'jobs') fetchJobs();
              if (activeTab === 'workers') fetchWorkers();
              if (activeTab === 'schedules') fetchScheduledJobs();
              if (activeTab === 'dlq') fetchDlqJobs();
            }}>
              <RefreshCw size={16} />
              Reload
            </button>
            <button className="btn-primary" onClick={() => {
              if (queues.length === 0) {
                alert('Please create a queue first!');
                return;
              }
              setJobModalQueue(queues[0].id);
              setShowJobModal(true);
            }}>
              <Plus size={16} />
              Trigger Job
            </button>
          </div>
        </header>

        {/* --- VIEW: DASHBOARD / OVERVIEW --- */}
        {activeTab === 'dashboard' && (
          <>
            {/* KPI Cards Grid */}
            <section className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-content">
                  <span className="kpi-label">Active Workers</span>
                  <span className="kpi-value">
                    {metrics.workerStats?.active || 0}{' '}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      / {(metrics.workerStats?.active || 0) + (metrics.workerStats?.inactive || 0)}
                    </span>
                  </span>
                </div>
                <div className="kpi-icon-wrapper primary">
                  <Cpu size={24} />
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-content">
                  <span className="kpi-label">Running Jobs</span>
                  <span className="kpi-value">{metrics.statusCounts.RUNNING}</span>
                </div>
                <div className="kpi-icon-wrapper warning">
                  <Activity size={24} />
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-content">
                  <span className="kpi-label">Success Rate</span>
                  <span className="kpi-value">
                    {metrics.statusCounts.COMPLETED + metrics.statusCounts.FAILED > 0
                      ? `${Math.round(
                          (metrics.statusCounts.COMPLETED / (metrics.statusCounts.COMPLETED + metrics.statusCounts.FAILED)) * 100
                        )}%`
                      : '100%'}
                  </span>
                </div>
                <div className="kpi-icon-wrapper success">
                  <CheckCircle2 size={24} />
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-content">
                  <span className="kpi-label">Backlogged</span>
                  <span className="kpi-value">{metrics.statusCounts.QUEUED}</span>
                </div>
                <div className="kpi-icon-wrapper danger">
                  <Clock size={24} />
                </div>
              </div>
            </section>

            {/* Charts & Throughput */}
            <div className="dashboard-layout">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Throughput (Completed vs Failed last 6h)</h3>
                  <span className="badge info">Live updates</span>
                </div>
                
                {/* Simulated SVG/Bar Chart */}
                <div className="chart-container">
                  {metrics.throughput.map((bar: any, index: number) => {
                    const total = bar.completed + bar.failed;
                    const maxVal = Math.max(...metrics.throughput.map((b: any) => b.completed + b.failed), 10);
                    const completedHeight = total > 0 ? (bar.completed / maxVal) * 100 : 0;
                    const failedHeight = total > 0 ? (bar.failed / maxVal) * 100 : 0;
                    
                    return (
                      <div className="chart-bar-wrapper" key={index}>
                        <div className="chart-bar" style={{ height: `${completedHeight + failedHeight}%`, width: '80%' }}>
                          <div className="chart-segment-success" style={{ height: `${total > 0 ? (bar.completed / total) * 100 : 0}%` }}></div>
                          <div className="chart-segment-failed" style={{ height: `${total > 0 ? (bar.failed / total) * 100 : 0}%` }}></div>
                        </div>
                        <div className="chart-tooltip">
                          <strong>{bar.time}</strong><br/>
                          Completed: {bar.completed}<br/>
                          Failed: {bar.failed}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="chart-x-axis">
                  <span>{metrics.throughput[0]?.time || 'Now-6h'}</span>
                  <span>{metrics.throughput[Math.floor(metrics.throughput.length / 2)]?.time || ''}</span>
                  <span>{metrics.throughput[metrics.throughput.length - 1]?.time || 'Now'}</span>
                </div>
              </div>

              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <h4 className="text-secondary" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Average Duration</h4>
                  <span className="kpi-value" style={{ fontSize: '2.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                    {metrics.avgDurationMs ? `${(metrics.avgDurationMs / 1000).toFixed(2)}s` : '0.00s'}
                  </span>
                  <p className="text-secondary" style={{ fontSize: '0.75rem', marginTop: '0.15rem' }}>
                    Last 6 hours. Lower is better.
                  </p>
                </div>
                
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <h4 className="text-secondary" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', textAlign: 'center' }}>
                    Status Distribution
                  </h4>
                  
                  {(() => {
                    const totalJobs = metrics.statusCounts.COMPLETED + metrics.statusCounts.FAILED + metrics.statusCounts.RUNNING + metrics.statusCounts.QUEUED;
                    const radius = 35;
                    const circ = 2 * Math.PI * radius; // ~219.91
                    
                    const completedPct = totalJobs > 0 ? (metrics.statusCounts.COMPLETED / totalJobs) : 0;
                    const failedPct = totalJobs > 0 ? (metrics.statusCounts.FAILED / totalJobs) : 0;
                    const runningPct = totalJobs > 0 ? (metrics.statusCounts.RUNNING / totalJobs) : 0;
                    const queuedPct = totalJobs > 0 ? (metrics.statusCounts.QUEUED / totalJobs) : 0;
                    
                    const cVal = completedPct * circ;
                    const fVal = failedPct * circ;
                    const rVal = runningPct * circ;
                    const qVal = queuedPct * circ;
                    
                    const cOffset = 0;
                    const fOffset = cVal;
                    const rOffset = cVal + fVal;
                    const qOffset = cVal + fVal + rVal;
                    
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ position: 'relative', width: '90px', height: '90px' }}>
                          <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: 'rotate(-90deg)' }}>
                            <circle cx="45" cy="45" r="35" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                            {cVal > 0 && (
                              <circle cx="45" cy="45" r="35" fill="transparent" stroke="#10b981" strokeWidth="8"
                                strokeDasharray={`${cVal} ${circ}`} strokeDashoffset={-cOffset} strokeLinecap="round" />
                            )}
                            {fVal > 0 && (
                              <circle cx="45" cy="45" r="35" fill="transparent" stroke="#ef4444" strokeWidth="8"
                                strokeDasharray={`${fVal} ${circ}`} strokeDashoffset={-fOffset} strokeLinecap="round" />
                            )}
                            {rVal > 0 && (
                              <circle cx="45" cy="45" r="35" fill="transparent" stroke="#6366f1" strokeWidth="8"
                                strokeDasharray={`${rVal} ${circ}`} strokeDashoffset={-rOffset} strokeLinecap="round" />
                            )}
                            {qVal > 0 && (
                              <circle cx="45" cy="45" r="35" fill="transparent" stroke="#f59e0b" strokeWidth="8"
                                strokeDasharray={`${qVal} ${circ}`} strokeDashoffset={-qOffset} strokeLinecap="round" />
                            )}
                          </svg>
                          <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            lineHeight: 1
                          }}>
                            <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>Total</span>
                            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff' }}>{totalJobs}</span>
                          </div>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem 0.5rem', width: '100%', fontSize: '0.7rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Done: {metrics.statusCounts.COMPLETED}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Fail: {metrics.statusCounts.FAILED}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
                            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Run: {metrics.statusCounts.RUNNING}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Queue: {metrics.statusCounts.QUEUED}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Quick Queues overview */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Queue Load Summaries</h3>
                <button className="btn-small primary" onClick={() => setShowQueueModal(true)}>
                  <Plus size={14} /> Create Queue
                </button>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Queue</th>
                      <th>Priority</th>
                      <th>Concurrency</th>
                      <th>Queued</th>
                      <th>Running</th>
                      <th>Completed</th>
                      <th>Failed</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.queueStats.map((qs: any) => (
                      <tr key={qs.id}>
                        <td style={{ fontWeight: 600 }}>
                          {qs.name}
                          {qs.shardsCount > 1 && (
                            <span className="badge info" style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.3rem' }}>
                              Shards: {qs.shardsCount}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${qs.priority >= 10 ? 'warning' : 'neutral'}`}>
                            Prio {qs.priority}
                          </span>
                        </td>
                        <td>Limit {qs.concurrencyLimit}</td>
                        <td className="cell-mono">{qs.counts.QUEUED}</td>
                        <td className="cell-mono" style={{ color: 'var(--color-warning)' }}>{qs.counts.RUNNING}</td>
                        <td className="cell-mono" style={{ color: 'var(--color-success)' }}>{qs.counts.COMPLETED}</td>
                        <td className="cell-mono" style={{ color: 'var(--color-danger)' }}>{qs.counts.FAILED}</td>
                        <td>
                          <span className={`badge ${qs.isPaused ? 'danger' : 'success'}`}>
                            {qs.isPaused ? 'Paused' : 'Active'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {metrics.queueStats.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                          No queues configured yet. Setup a queue to start processing.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* --- VIEW: QUEUES --- */}
        {activeTab === 'queues' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem', gap: '0.75rem' }}>
              <button className="btn-secondary" onClick={() => setShowPolicyModal(true)}>
                Manage Retry Policies
              </button>
              <button className="btn-primary" onClick={() => setShowQueueModal(true)}>
                <Plus size={16} /> Create Queue
              </button>
            </div>

            <div className="queue-card-grid">
              {queues.map((q) => {
                const activeJob = q._count?.jobs || 0;
                return (
                  <div key={q.id} className={`queue-card ${q.priority >= 10 ? 'high-prio' : ''} ${q.isPaused ? 'paused' : ''}`}>
                    <div className="queue-header">
                      <div>
                        <span className="queue-name">{q.name}</span>
                        <div className="queue-project">{q.project.name}</div>
                      </div>
                      <span className={`badge ${q.isPaused ? 'danger' : 'success'}`}>
                        {q.isPaused ? 'Paused' : 'Active'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                      <div>Priority: <strong style={{ color: '#fff' }}>{q.priority}</strong></div>
                      <div>Concurrency limit: <strong style={{ color: '#fff' }}>{q.concurrencyLimit}</strong></div>
                    </div>
                    
                    {q.shardsCount > 1 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(59, 130, 246, 0.08)', padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '1rem', border: '1px dashed rgba(59, 130, 246, 0.2)' }}>
                        Queue Shards: <strong>{q.shardsCount} virtual shards</strong>
                      </div>
                    )}

                    {q.retryPolicy && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.15)', padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
                        Retry: <strong>{q.retryPolicy.name}</strong> ({q.retryPolicy.strategy})
                      </div>
                    )}

                    {q.rateLimitMax && q.rateLimitWindow && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(99, 102, 241, 0.08)', padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '1rem', border: '1px dashed rgba(99, 102, 241, 0.2)' }}>
                        Rate Limit: <strong>{q.rateLimitMax} jobs</strong> per <strong>{q.rateLimitWindow}s</strong>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Currently running: <strong>{activeJob}</strong>
                      </span>
                      
                      <button
                        className={`btn-small ${q.isPaused ? 'primary' : 'secondary'}`}
                        onClick={() => toggleQueuePause(q.id, q.isPaused)}
                      >
                        {q.isPaused ? <Play size={12} /> : <Pause size={12} />}
                        {q.isPaused ? 'Resume Processing' : 'Pause Queue'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* --- VIEW: JOBS EXPLORER --- */}
        {activeTab === 'jobs' && (
          <div className="card">
            {/* Filter bar */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0 0.75rem', flexGrow: 1, minWidth: '200px' }}>
                <Search size={16} className="text-secondary" />
                <input
                  type="text"
                  placeholder="Search payload (JSON keys/values)..."
                  className="form-input"
                  style={{ border: 'none', background: 'transparent' }}
                  value={jobSearch}
                  onChange={(e) => { setJobSearch(e.target.value); setJobPage(1); }}
                />
              </div>

              <select
                className="form-select"
                style={{ width: '150px' }}
                value={jobFilterStatus}
                onChange={(e) => { setJobFilterStatus(e.target.value); setJobPage(1); }}
              >
                <option value="">All Statuses</option>
                <option value="QUEUED">QUEUED</option>
                <option value="SCHEDULED">SCHEDULED</option>
                <option value="RUNNING">RUNNING</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="FAILED">FAILED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>

              <select
                className="form-select"
                style={{ width: '180px' }}
                value={jobFilterQueue}
                onChange={(e) => { setJobFilterQueue(e.target.value); setJobPage(1); }}
              >
                <option value="">All Queues</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>{q.name}</option>
                ))}
              </select>

              <button className="btn-secondary" onClick={() => {
                setJobSearch('');
                setJobFilterStatus('');
                setJobFilterQueue('');
                setJobPage(1);
              }}>
                Reset Filters
              </button>
            </div>

            {/* Table */}
            <div className="table-container">
              {loadingJobs ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  <RefreshCw size={24} className="icon-spin" style={{ animation: 'spin 2s linear infinite', margin: '0 auto 1rem' }} />
                  Retrieving execution lists...
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>Type</th>
                      <th>Queue</th>
                      <th>Retries</th>
                      <th>Worker</th>
                      <th>Status</th>
                      <th>Created At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} style={{ cursor: 'pointer' }} onClick={() => openJobLogDetails(job)}>
                        <td className="cell-mono" style={{ color: 'var(--color-primary)' }}>{job.id.substring(0, 8)}...</td>
                        <td style={{ fontWeight: 600 }}>
                          {job.jobType}
                          {job.priority > 1 && (
                            <span className="badge warning" style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.3rem' }}>
                              Priority {job.priority}
                            </span>
                          )}
                        </td>
                        <td>
                          {job.queue.name}
                          {job.shardId > 0 && (
                            <span className="badge info" style={{ marginLeft: '0.35rem', fontSize: '0.6rem', padding: '0.05rem 0.2rem' }}>
                              Shard {job.shardId}
                            </span>
                          )}
                        </td>
                        <td className="cell-mono">{job.retriesCount} / {job.maxRetries}</td>
                        <td>{job.worker?.name || <span className="text-muted">None</span>}</td>
                        <td>
                          <span className={`badge ${
                            job.status === 'COMPLETED' ? 'success' :
                            job.status === 'RUNNING' ? 'warning' :
                            job.status === 'FAILED' ? 'danger' :
                            job.status === 'SCHEDULED' ? 'info' : 'neutral'
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td>{new Date(job.createdAt).toLocaleString()}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button className="btn-small" onClick={() => openJobLogDetails(job)}>
                              <TerminalIcon size={12} /> Trace Logs
                            </button>
                            {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
                              <button className="btn-small primary" onClick={() => triggerRetryJob(job.id)}>
                                <RefreshCw size={12} /> Retry
                              </button>
                            )}
                            {['QUEUED', 'SCHEDULED', 'RUNNING'].includes(job.status) && (
                              <button className="btn-small" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }} onClick={() => triggerCancelJob(job.id)}>
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {jobs.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                          No jobs match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            <div className="pagination-group">
              <span className="pagination-text">
                Page <strong>{jobPage}</strong> of <strong>{jobTotalPages}</strong>
              </span>
              <button
                className="icon-btn"
                disabled={jobPage === 1}
                onClick={() => setJobPage((p) => Math.max(p - 1, 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="icon-btn"
                disabled={jobPage === jobTotalPages || jobTotalPages === 0}
                onClick={() => setJobPage((p) => Math.min(p + 1, jobTotalPages))}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* --- VIEW: WORKERS --- */}
        {activeTab === 'workers' && (
          <div className="worker-grid">
            {workers.map((w) => {
              const hb = w.heartbeats[0];
              const cpu = hb ? hb.cpuUsage : 0;
              const ram = hb ? hb.ramUsage : 0;
              const activeCount = hb ? hb.activeJobsCount : 0;

              return (
                <div key={w.id} className="worker-card">
                  <div className="worker-header">
                    <div className={`worker-status-dot ${w.status === 'ACTIVE' ? 'active' : 'inactive'}`}></div>
                    <div>
                      <div className="worker-name">{w.name}</div>
                      <div className="worker-host">host: {w.host}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '0.75rem', borderRadius: '10px', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Active Tasks</div>
                      <strong style={{ fontSize: '1.15rem' }}>{activeCount}</strong>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Last Heartbeat</div>
                      <strong>{new Date(w.lastHeartbeatAt).toLocaleTimeString()}</strong>
                    </div>
                  </div>

                  <div className="metric-bar-group">
                    <div className="metric-bar-header">
                      <span>CPU Utilization</span>
                      <strong>{cpu}%</strong>
                    </div>
                    <div className="metric-bar-track">
                      <div
                        className={`metric-bar-fill ${cpu > 80 ? 'critical' : cpu > 50 ? 'warning' : 'normal'}`}
                        style={{ width: `${cpu}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="metric-bar-group">
                    <div className="metric-bar-header">
                      <span>RAM Allocation</span>
                      <strong>{ram}%</strong>
                    </div>
                    <div className="metric-bar-track">
                      <div
                        className={`metric-bar-fill ${ram > 90 ? 'critical' : ram > 70 ? 'warning' : 'normal'}`}
                        style={{ width: `${ram}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              );
            })}
            {workers.length === 0 && (
              <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                No workers registered. Start a worker node process to claim queues:
                <pre style={{ background: '#000', padding: '1rem', borderRadius: '10px', width: 'fit-content', margin: '1rem auto', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#a5b4fc' }}>
                  node worker.js --name node-1
                </pre>
              </div>
            )}
          </div>
        )}

        {/* --- VIEW: CRON SCHEDULES --- */}
        {activeTab === 'schedules' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
              <button className="btn-primary" onClick={() => {
                if (queues.length === 0) {
                  alert('Please create a queue first!');
                  return;
                }
                setJobModalQueue(queues[0].id);
                setJobModalCron('*/5 * * * *');
                setJobModalCronName('5-Minute Sync');
                setShowJobModal(true);
              }}>
                <Plus size={16} /> Create Recurring Cron
              </button>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Schedule Name</th>
                    <th>Queue</th>
                    <th>Cron Expression</th>
                    <th>Task Type</th>
                    <th>Next Run At</th>
                    <th>Last Run At</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledJobs.map((sched) => (
                    <tr key={sched.id}>
                      <td style={{ fontWeight: 600 }}>{sched.name}</td>
                      <td>{sched.queue.name}</td>
                      <td className="cell-mono" style={{ color: 'var(--color-primary)' }}>{sched.cronExpression}</td>
                      <td>{sched.jobType}</td>
                      <td>{new Date(sched.nextRunAt).toLocaleString()}</td>
                      <td>{sched.lastRunAt ? new Date(sched.lastRunAt).toLocaleString() : <span className="text-muted">Never run</span>}</td>
                      <td>
                        <span className={`badge ${sched.isActive ? 'success' : 'neutral'}`}>
                          {sched.isActive ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td>
                        <button className="icon-btn danger" onClick={() => triggerDeleteScheduled(sched.id)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {scheduledJobs.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>
                        No cron triggers scheduled yet. Set up a schedule to execute jobs periodically.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- VIEW: DEAD LETTER QUEUE (DLQ) --- */}
        {activeTab === 'dlq' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem', alignItems: 'center' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Total failures quarantined: <strong>{dlqJobs.length}</strong>
              </div>
              
              {dlqJobs.length > 0 && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn-secondary" style={{ color: 'var(--color-danger)' }} onClick={triggerDlqPurge}>
                    <Trash2 size={14} /> Purge DLQ
                  </button>
                  <button className="btn-primary" onClick={triggerDlqRetryAll}>
                    <RefreshCw size={14} /> Retry All Entries
                  </button>
                </div>
              )}
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Queue</th>
                    <th>Type</th>
                    <th>Failure Reason</th>
                    <th>Failed At</th>
                    <th>Payload</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dlqJobs.map((dlq) => (
                    <tr key={dlq.id}>
                      <td className="cell-mono">{dlq.jobId ? dlq.jobId.substring(0, 8) : 'orphaned'}...</td>
                      <td>{dlq.queue.name}</td>
                      <td style={{ fontWeight: 600 }}>{dlq.jobType}</td>
                      <td style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{dlq.errorReason}</td>
                      <td>{new Date(dlq.failedAt).toLocaleString()}</td>
                      <td className="cell-mono" style={{ fontSize: '0.75rem', opacity: 0.8 }} title={dlq.payload}>
                        {dlq.payload.substring(0, 30)}...
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button className="btn-small primary" onClick={() => triggerRetryDlqEntry(dlq.id)}>
                            <RefreshCw size={12} /> Retry
                          </button>
                          <button className="btn-small" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }} onClick={() => triggerDeleteDlqEntry(dlq.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dlqJobs.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                        Dead Letter Queue is empty. No permanent worker execution failures detected.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* --- MODAL: CREATE QUEUE --- */}
      {showQueueModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">Create New Job Queue</h2>
              <button className="modal-close" onClick={() => setShowQueueModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleCreateQueue}>
              <div className="form-group">
                <label className="form-label">Queue Name</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="image-resizing"
                  value={queueModalName}
                  onChange={(e) => setQueueModalName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Project Workspace</label>
                <select
                  className="form-select"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="form-label">Queue Priority (1-100)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    required
                    className="form-input"
                    value={queueModalPrio}
                    onChange={(e) => setQueueModalPrio(parseInt(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <label className="form-label">Concurrency Limit (max active)</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    required
                    className="form-input"
                    value={queueModalLimit}
                    onChange={(e) => setQueueModalLimit(parseInt(e.target.value) || 5)}
                  />
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Associated Retry Policy</label>
                  <span className="auth-link" style={{ fontSize: '0.8rem' }} onClick={() => setShowPolicyModal(true)}>
                    + Create New Policy
                  </span>
                </div>
                <select
                  className="form-select"
                  value={queueModalPolicy}
                  onChange={(e) => setQueueModalPolicy(e.target.value)}
                >
                  <option value="">No retry policy (Default 3 attempts, 5s delay)</option>
                  {retryPolicies.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.strategy})</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="form-label">Rate Limit: Max Jobs (Optional)</label>
                  <input
                    type="number"
                    min="1"
                    className="form-input"
                    placeholder="e.g. 10"
                    value={queueModalRateMax}
                    onChange={(e) => setQueueModalRateMax(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Sliding Window (Seconds)</label>
                  <input
                    type="number"
                    min="1"
                    className="form-input"
                    placeholder="e.g. 60"
                    value={queueModalRateWindow}
                    onChange={(e) => setQueueModalRateWindow(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Queue Sharding: Shards Count (1-10, default 1 = no sharding)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  required
                  className="form-input"
                  value={queueModalShards}
                  onChange={(e) => setQueueModalShards(parseInt(e.target.value) || 1)}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowQueueModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Initialize Queue</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: CREATE RETRY POLICY --- */}
      {showPolicyModal && (
        <div className="modal-overlay" style={{ zIndex: 110 }}>
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Create Retry Policy</h2>
              <button className="modal-close" onClick={() => setShowPolicyModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleCreateRetryPolicy}>
              <div className="form-group">
                <label className="form-label">Policy Name</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="3x Exponential Backoff"
                  value={policyModalName}
                  onChange={(e) => setPolicyModalName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Delay Strategy</label>
                <select
                  className="form-select"
                  value={policyModalStrategy}
                  onChange={(e) => setPolicyModalStrategy(e.target.value as any)}
                >
                  <option value="FIXED">FIXED (Always same delay)</option>
                  <option value="LINEAR">LINEAR (Base delay * attempt)</option>
                  <option value="EXPONENTIAL">EXPONENTIAL (Base delay * mult^attempt)</option>
                </select>
              </div>

              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="form-label">Base Delay (seconds)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="form-input"
                    value={policyModalDelay}
                    onChange={(e) => setPolicyModalDelay(parseInt(e.target.value) || 5)}
                  />
                </div>
                <div>
                  <label className="form-label">Max Retries</label>
                  <input
                    type="number"
                    min="0"
                    required
                    className="form-input"
                    value={policyModalRetries}
                    onChange={(e) => setPolicyModalRetries(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              {policyModalStrategy === 'EXPONENTIAL' && (
                <div className="form-group">
                  <label className="form-label">Backoff Multiplier</label>
                  <input
                    type="number"
                    min="1.0"
                    step="0.1"
                    required
                    className="form-input"
                    value={policyModalMultiplier}
                    onChange={(e) => setPolicyModalMultiplier(parseFloat(e.target.value) || 1.5)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowPolicyModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Save Policy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: TRIGGER/SPAWN JOB --- */}
      {showJobModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Trigger New Background Job</h2>
              <button className="modal-close" onClick={() => setShowJobModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleCreateJob}>
              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="form-label">Target Queue</label>
                  <select
                    className="form-select"
                    value={jobModalQueue}
                    onChange={(e) => setJobModalQueue(e.target.value)}
                  >
                    {queues.map((q) => (
                      <option key={q.id} value={q.id}>{q.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Execution Type</label>
                  <select
                    className="form-select"
                    value={jobModalType}
                    onChange={(e) => {
                      setJobModalType(e.target.value);
                      // Update dummy payloads based on selections
                      if (e.target.value === 'email') {
                        setJobModalPayload(JSON.stringify({ to: 'customer@domain.com', subject: 'System Alert', body: 'Your queued report has generated.' }, null, 2));
                      } else if (e.target.value === 'report') {
                        setJobModalPayload(JSON.stringify({ reportId: `REP-${Math.floor(Math.random() * 9000) + 1000}`, format: 'PDF' }, null, 2));
                      } else if (e.target.value === 'data_sync') {
                        setJobModalPayload(JSON.stringify({ service: 'Stripe', entities: ['customers', 'charges'] }, null, 2));
                      } else if (e.target.value === 'db_maintenance') {
                        setJobModalPayload(JSON.stringify({ cleanOrphans: true }, null, 2));
                      } else {
                        setJobModalPayload('{}');
                      }
                    }}
                  >
                    <option value="email">email (Sends SMTP Simulation)</option>
                    <option value="report">report (Generates PDF Analytics Document)</option>
                    <option value="data_sync">data_sync (Stripe/Salesforce Sync - Failures simulated!)</option>
                    <option value="db_maintenance">db_maintenance (Vacuum & Reindex Databases)</option>
                    <option value="generic">generic (Standard Dummy execution)</option>
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="form-label">Delayed Start (seconds, 0 for immediate)</label>
                  <input
                    type="number"
                    min="0"
                    className="form-input"
                    value={jobModalDelay}
                    onChange={(e) => setJobModalDelay(parseInt(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="form-label">Dependency: Parent Job ID (optional)</label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    placeholder="UUID of dependent job"
                    value={jobModalParentId}
                    onChange={(e) => setJobModalParentId(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Job Priority (1-10, higher = claimed first)</label>
                <select
                  className="form-select"
                  value={jobModalPriority}
                  onChange={(e) => setJobModalPriority(parseInt(e.target.value) || 1)}
                  disabled={jobModalIsBatch || jobModalCron !== ''}
                >
                  <option value="1">Priority 1 (Low / Default)</option>
                  <option value="2">Priority 2</option>
                  <option value="3">Priority 3</option>
                  <option value="5">Priority 5 (Medium)</option>
                  <option value="8">Priority 8</option>
                  <option value="10">Priority 10 (Highest / Urgent)</option>
                </select>
              </div>

              {/* Recurring cron options */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={jobModalCron !== ''} onChange={(e) => {
                      if (e.target.checked) {
                        setJobModalCron('*/5 * * * *');
                        setJobModalCronName('Periodic Data Refresher');
                        setJobModalIsBatch(false);
                      } else {
                        setJobModalCron('');
                        setJobModalCronName('');
                      }
                    }} />
                    Setup as Recurring Cron Job
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={jobModalIsBatch} disabled={jobModalCron !== ''} onChange={(e) => {
                      setJobModalIsBatch(e.target.checked);
                    }} />
                    Spawn as a Batch Job Set
                  </label>
                </div>

                {jobModalCron !== '' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="form-label">Cron Expression</label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={jobModalCron}
                        onChange={(e) => setJobModalCron(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="form-label">Cron Rule Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={jobModalCronName}
                        onChange={(e) => setJobModalCronName(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {jobModalIsBatch && (
                  <div>
                    <label className="form-label">Number of Jobs to Queue (Batch size)</label>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      className="form-input"
                      value={jobModalBatchCount}
                      onChange={(e) => setJobModalBatchCount(parseInt(e.target.value) || 5)}
                    />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">JSON Input Payload</label>
                <textarea
                  className="form-textarea"
                  value={jobModalPayload}
                  onChange={(e) => setJobModalPayload(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowJobModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Submit to Queue</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: DETAILED JOB LOGS TERMINAL --- */}
      {selectedJob && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '750px' }}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Job Execution Trace Logs</h2>
                <div className="cell-mono" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>ID: {selectedJob.id}</div>
              </div>
              <button className="modal-close" onClick={() => { setSelectedJob(null); setPollLogsActive(false); }}><X size={20} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
              <div>
                <span className="text-secondary">Type:</span> <strong>{selectedJob.jobType}</strong>
              </div>
              <div>
                <span className="text-secondary">Queue:</span> <strong>{selectedJob.queue?.name}</strong>
              </div>
              <div>
                <span className="text-secondary">Status:</span>{' '}
                <span className={`badge ${
                  selectedJob.status === 'COMPLETED' ? 'success' :
                  selectedJob.status === 'RUNNING' ? 'warning' :
                  selectedJob.status === 'FAILED' ? 'danger' : 'neutral'
                }`}>
                  {selectedJob.status}
                </span>
              </div>
              <div>
                <span className="text-secondary">Current Attempts:</span> <strong>{selectedJob.retriesCount} / {selectedJob.maxRetries}</strong>
              </div>
            </div>

            {/* AI Diagnostics Box */}
            {selectedJob.aiSummary && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: '12px',
                padding: '1rem',
                marginBottom: '1.25rem',
                fontSize: '0.875rem',
                boxShadow: '0 4px 20px rgba(139, 92, 246, 0.08)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: '#c084fc', marginBottom: '0.5rem' }}>
                  <Sparkles size={16} style={{ filter: 'drop-shadow(0 0 4px rgba(192, 132, 252, 0.6))' }} />
                  <span>AI Failure Diagnosis & Recommendation</span>
                </div>
                <p style={{ color: '#e9d5ff', lineHeight: 1.5 }}>
                  {selectedJob.aiSummary}
                </p>
              </div>
            )}

            {/* Terminal logs */}
            <div style={{ display: 'flex', justifySelf: 'space-between', alignContent: 'center', marginBottom: '0.5rem' }}>
              <span className="form-label" style={{ margin: 0 }}>Stdout Logs Stream</span>
              {pollLogsActive && (
                <span className="badge warning" style={{ animation: 'pulse 1.5s infinite', textTransform: 'none' }}>
                  Streaming live...
                </span>
              )}
            </div>
            <div className="terminal">
              {selectedJobLogs.map((l) => (
                <div key={l.id} className={`terminal-line ${l.level.toLowerCase()}`}>
                  <span className="terminal-time">[{new Date(l.timestamp).toLocaleTimeString()}]</span>
                  <span>{l.message}</span>
                </div>
              ))}
              {selectedJobLogs.length === 0 && (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
                  No log entries recorded for this job.
                </div>
              )}
            </div>

            {/* Execution History */}
            <h3 className="form-label" style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Attempts History</h3>
            <div className="table-container" style={{ margin: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Attempt</th>
                    <th>Worker</th>
                    <th>Execution Status</th>
                    <th>Duration</th>
                    <th>Error Context</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedJobExecutions.map((exec) => (
                    <tr key={exec.id}>
                      <td className="cell-mono">#{exec.retryCount + 1}</td>
                      <td>{exec.workerId || 'none'}</td>
                      <td>
                        <span className={`badge ${exec.status === 'COMPLETED' ? 'success' : exec.status === 'RUNNING' ? 'warning' : 'danger'}`}>
                          {exec.status}
                        </span>
                      </td>
                      <td>{exec.durationMs ? `${(exec.durationMs / 1000).toFixed(2)}s` : '-'}</td>
                      <td style={{ color: 'var(--color-danger)', fontSize: '0.8rem', whiteSpace: 'normal', maxWidth: '200px' }}>
                        {exec.errorMessage || <span className="text-muted">-</span>}
                      </td>
                    </tr>
                  ))}
                  {selectedJobExecutions.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                        No execution trials logged.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
              {(selectedJob.status === 'FAILED' || selectedJob.status === 'CANCELLED') && (
                <button className="btn-primary" style={{ width: 'auto' }} onClick={() => triggerRetryJob(selectedJob.id)}>
                  <RefreshCw size={14} /> Re-queue Job
                </button>
              )}
              {['QUEUED', 'SCHEDULED', 'RUNNING'].includes(selectedJob.status) && (
                <button className="btn-secondary" style={{ color: 'var(--color-danger)' }} onClick={() => triggerCancelJob(selectedJob.id)}>
                  Cancel Execution
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={() => { setSelectedJob(null); setPollLogsActive(false); }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
