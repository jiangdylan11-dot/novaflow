// Runtime Adapter (spec 4).
//
// The stable Desktop renderer reaches the outside world through Electron IPC,
// a local ComfyUI on 127.0.0.1 and the Node filesystem. None of that exists in
// a browser. Rather than teaching the Desktop runtime about the web - which
// would mean editing the stable product - the Web line implements the same
// capabilities behind its own adapter.
//
// WebRuntime is the only place in the browser app that knows a network exists.
// Swapping it is how a future transport (tunnel, relay) gets added without
// touching a single component.

export type TaskStatus =
  | 'created' | 'queued' | 'assigned' | 'uploading'
  | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface Task {
  id: string;
  task_type: string;
  model_id: string;
  status: TaskStatus;
  progress: number;
  progress_note: string;
  assigned_worker_id: string | null;
  output_manifest: { files?: OutputFile[]; endpoint_url?: string; expires_at?: string };
  parameters: Record<string, unknown>;
  estimated_credit_cost: number;
  charged_credit_cost: number;
  credit_settled: boolean;
  attempt_count: number;
  error_code: string;
  error_message: string;
  result_expired: boolean;
  created_at: string;
  completed_at: string | null;
  failed_at: string | null;
}

export interface OutputFile {
  name: string;
  kind: 'image' | 'video';
  bytes: number;
  width?: number;
  height?: number;
  duration_seconds?: number;
}

export interface WorkerRow {
  id: string;
  worker_name: string;
  status: string;
  gpu_name: string;
  vram_mb: number;
  comfy_version: string;
  endpoint_url: string;
  last_heartbeat: string | null;
  total_completed: number;
  total_failed: number;
}

export interface Grant {
  token: string;
  op: 'upload' | 'download';
  taskId: string;
  workerId: string;
  endpoint: string;
  transport: string;
  expiresAt: string;
}

export interface Session {
  token: string;
  user: { id: string; email: string; display_name?: string };
  credits: { balance: number };
}

export class RuntimeError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const SESSION_KEY = 'novaflow_web_session_v1';

export class WebRuntime {
  readonly controlUrl: string;
  readonly authUrl: string;
  private session: Session | null = null;

  constructor(opts: { controlUrl: string; authUrl: string }) {
    this.controlUrl = opts.controlUrl.replace(/\/+$/, '');
    this.authUrl = opts.authUrl.replace(/\/+$/, '');
    this.session = this.loadSession();
  }

  // -------------------------------------------------------------------------
  // Session. Persisted in localStorage only so a refresh does not log the user
  // out; the token is short-lived and the server is the authority.
  // -------------------------------------------------------------------------
  private loadSession(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }

  private saveSession(session: Session | null) {
    this.session = session;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* private mode: the session simply does not survive a refresh */
    }
  }

  get currentSession(): Session | null {
    return this.session;
  }

  get isSignedIn(): boolean {
    return Boolean(this.session?.token);
  }

  private async request<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(this.session?.token ? { authorization: 'Bearer ' + this.session.token } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new RuntimeError(
        '无法连接服务（' + base + '）：' + String((error as Error)?.message || error),
        'network_error',
        0
      );
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: text.slice(0, 300) };
    }

    if (!res.ok) {
      // A dead session must log the user out rather than leaving the UI in a
      // state where every action fails silently.
      if (res.status === 401 && this.session) this.saveSession(null);
      throw new RuntimeError(
        String(parsed.error || ('请求失败 ' + res.status)),
        String(parsed.code || 'error'),
        res.status
      );
    }
    return parsed as T;
  }

  // -------------------------------------------------------------------------
  // Auth. Goes to the EXISTING novaflow-backend, unchanged, so a Web login and
  // a Desktop login are the same account with the same credits.
  // -------------------------------------------------------------------------
  async login(account: string, password: string): Promise<Session> {
    const res = await this.request<{
      session: { token: string };
      user: Session['user'];
      credits: { balance: number };
    }>(this.authUrl, 'POST', '/api/auth/login', { account, password });

    const session: Session = {
      token: res.session.token,
      user: res.user,
      credits: res.credits || { balance: 0 }
    };
    this.saveSession(session);
    return session;
  }

  logout() {
    this.saveSession(null);
  }

  /**
   * True only when the control plane is on loopback. Gates the local
   * acceptance login below so it can never appear in a deployed build.
   */
  get isLocalControlPlane(): boolean {
    try {
      const host = new URL(this.controlUrl).hostname;
      return host === '127.0.0.1' || host === 'localhost' || host === '::1';
    } catch {
      return false;
    }
  }

  /**
   * Local acceptance login. Talks to the LOCAL control plane's /dev/login,
   * which exists only in control-local and is not part of the deployed edge
   * function. Production sign-in always goes through novaflow-backend above.
   */
  async devLogin(email: string, balance = 1000): Promise<Session> {
    if (!this.isLocalControlPlane) throw new RuntimeError('本地登录仅在本地控制面可用', 'forbidden', 403);
    const res = await this.request<{
      session: { token: string };
      user: Session['user'];
      credits: { balance: number };
    }>(this.controlUrl, 'POST', '/dev/login', { email, balance });
    const session: Session = {
      token: res.session.token,
      user: res.user,
      credits: res.credits || { balance: 0 }
    };
    this.saveSession(session);
    return session;
  }

  /**
   * Balance comes from the control plane, which reads the same credits table
   * novaflow-backend does. One call that works identically against the local
   * control plane and against Supabase.
   */
  async refreshCredits(): Promise<number> {
    const res = await this.request<{ credits: { balance: number } }>(
      this.controlUrl, 'GET', '/api/web/me'
    );
    const balance = Number(res.credits?.balance || 0);
    if (this.session) this.saveSession({ ...this.session, credits: { balance } });
    return balance;
  }

  // -------------------------------------------------------------------------
  // Capabilities, workers, tasks - the Web control plane.
  // -------------------------------------------------------------------------
  async capabilities() {
    return await this.request<{
      taskTypes: { task_type: string; model_id: string; min_vram_mb: number; kind: string; label: string }[];
      models: { model_id: string; display_name: string; version: string }[];
    }>(this.controlUrl, 'GET', '/api/web/capabilities');
  }

  async listWorkers(): Promise<WorkerRow[]> {
    const res = await this.request<{ workers: WorkerRow[] }>(this.controlUrl, 'GET', '/api/web/workers');
    return res.workers || [];
  }

  async listTasks(limit = 30): Promise<Task[]> {
    const res = await this.request<{ tasks: Task[] }>(
      this.controlUrl, 'GET', '/api/web/tasks?limit=' + limit
    );
    return res.tasks || [];
  }

  async createTask(taskType: string, parameters: Record<string, unknown>) {
    return await this.request<{
      task: Task;
      pricing: { creditCost: number; breakdown: Record<string, unknown> };
      capableWorkers: number;
      warning: string | null;
    }>(this.controlUrl, 'POST', '/api/web/tasks', { task_type: taskType, parameters });
  }

  async getTask(taskId: string): Promise<Task> {
    const res = await this.request<{ task: Task }>(this.controlUrl, 'GET', '/api/web/tasks/' + taskId);
    return res.task;
  }

  async cancelTask(taskId: string): Promise<Task> {
    const res = await this.request<{ task: Task }>(
      this.controlUrl, 'POST', '/api/web/tasks/' + taskId + '/cancel'
    );
    return res.task;
  }

  async grant(taskId: string, op: 'upload' | 'download'): Promise<Grant> {
    const res = await this.request<{ grant: Grant }>(
      this.controlUrl, 'POST', '/api/web/tasks/' + taskId + '/grant', { op }
    );
    return res.grant;
  }

  // -------------------------------------------------------------------------
  // Direct browser <-> worker transfer (spec 11, 12). Big files never pass
  // through Supabase; they go straight to the machine that will use them.
  // -------------------------------------------------------------------------
  async uploadInput(taskId: string, file: File, name: string, onProgress?: (pct: number) => void, slot?: string) {
    const g = await this.grant(taskId, 'upload');
    const url = g.endpoint.replace(/\/+$/, '') + '/gw/tasks/' + taskId + '/input/' + encodeURIComponent(name);

    // XHR rather than fetch: upload progress is the one thing fetch still
    // cannot report, and a user watching a 40MB reference upload needs it.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('x-novaflow-grant', g.token);
      if (slot) xhr.setRequestHeader('x-novaflow-upload-slot', slot);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new RuntimeError('上传失败：' + xhr.status + ' ' + xhr.responseText.slice(0, 200), 'upload_failed', xhr.status));
      };
      xhr.onerror = () => reject(new RuntimeError('上传失败：无法连接算力节点 ' + g.endpoint, 'network_error', 0));
      xhr.send(file);
    });
    return { name, grant: g };
  }

  /**
   * A URL the browser can put straight into <img src> or <video src>.
   * The grant rides in the query string because media elements cannot send a
   * custom header; it is short-lived and scoped to this one task and file.
   */
  resultUrl(task: Task, file: OutputFile, grant: Grant, opts: { download?: boolean } = {}) {
    const endpoint = (grant.endpoint || task.output_manifest.endpoint_url || '').replace(/\/+$/, '');
    const qs = new URLSearchParams({ grant: grant.token });
    if (opts.download) qs.set('download', '1');
    return endpoint + '/gw/tasks/' + task.id + '/output/' + encodeURIComponent(file.name) + '?' + qs.toString();
  }

  /**
   * Follow a task to a terminal state.
   *
   * Polling, not Realtime: Supabase Realtime needs an anon key in the browser
   * and a table the browser may subscribe to, and this data plane is
   * service-role-only by design. Polling the control plane keeps that boundary
   * intact and costs one small request a second. The interface below is what a
   * Realtime implementation would satisfy, so swapping it later touches only
   * this method.
   */
  watchTask(taskId: string, onUpdate: (task: Task) => void, opts: { intervalMs?: number } = {}) {
    const interval = opts.intervalMs ?? 1000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped) return;
      try {
        const task = await this.getTask(taskId);
        if (stopped) return;
        onUpdate(task);
        if (['completed', 'failed', 'cancelled', 'expired'].includes(task.status)) return;
      } catch (error) {
        if (stopped) return;
        // A transient failure should not abandon a running task; keep polling.
        if ((error as RuntimeError).status === 404) return;
      }
      timer = setTimeout(tick, interval);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

export function createRuntime() {
  const env = import.meta.env as Record<string, string | undefined>;
  return new WebRuntime({
    controlUrl: env.VITE_NOVAFLOW_CONTROL_URL || 'http://127.0.0.1:4890',
    authUrl: env.VITE_NOVAFLOW_AUTH_URL
      || 'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'
  });
}
