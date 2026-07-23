/**
 * In-app log capture — intercepts console.log/warn/error and stores them
 * so they can be displayed in a floating debug panel (works in release builds).
 */

export type LogEntry = {
  id: number;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: string;
};

const MAX_LOGS = 500;
let logs: LogEntry[] = [];
let nextId = 1;
let listeners = new Set<() => void>();
let installed = false;

// Keep references to originals so we still output to logcat
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
};

function addLog(level: LogEntry['level'], args: any[]) {
  const message = args
    .map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    })
    .join(' ');

  const now = new Date();
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

  logs.push({ id: nextId++, level, message, timestamp });
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(-MAX_LOGS);
  }
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

export const logCapture = {
  /** Install console interceptors. Call once at app startup. */
  install() {
    if (installed) return;
    installed = true;

    console.log = (...args: any[]) => {
      originalConsole.log(...args);
      addLog('log', args);
    };
    console.warn = (...args: any[]) => {
      originalConsole.warn(...args);
      addLog('warn', args);
    };
    console.error = (...args: any[]) => {
      originalConsole.error(...args);
      addLog('error', args);
    };
    console.info = (...args: any[]) => {
      originalConsole.info(...args);
      addLog('info', args);
    };
  },

  /** Get all captured logs. */
  getLogs(): LogEntry[] {
    return logs;
  },

  /** Clear all logs. */
  clear() {
    logs = [];
    for (const cb of listeners) {
      try { cb(); } catch {}
    }
  },

  /** Subscribe to log updates. Returns unsubscribe function. */
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};
