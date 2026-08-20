import { Worker } from 'node:worker_threads';
import type { RuntimeKind } from './types.js';

export interface AppDiscoveryEntry {
  name: string;
  path: string;
  bundleId: string | null;
  runtime: RuntimeKind;
  appId: string;
  executablePath: string;
}

interface WorkerResponse {
  id: number;
  apps?: AppDiscoveryEntry[];
  error?: string;
}

interface PendingRequest {
  resolve(apps: AppDiscoveryEntry[]): void;
  reject(error: Error): void;
}

export class AppDiscoveryService {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private cached: { modulePath: string; scannedAt: number; apps: AppDiscoveryEntry[] } | null = null;
  private inFlight: { modulePath: string; promise: Promise<AppDiscoveryEntry[]> } | null = null;

  scan(modulePath: string, maxAgeMs = 1_000): Promise<AppDiscoveryEntry[]> {
    const now = Date.now();
    if (this.cached?.modulePath === modulePath && now - this.cached.scannedAt <= maxAgeMs) {
      return Promise.resolve(this.cached.apps);
    }
    if (this.inFlight?.modulePath === modulePath) return this.inFlight.promise;

    const promise = this.requestScan(modulePath).then((apps) => {
      this.cached = { modulePath, scannedAt: Date.now(), apps };
      return apps;
    }).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { modulePath, promise };
    return promise;
  }

  close(): void {
    const worker = this.worker;
    this.worker = null;
    this.cached = null;
    this.inFlight = null;
    for (const request of this.pending.values()) {
      request.reject(new Error('Attune app discovery worker stopped.'));
    }
    this.pending.clear();
    if (worker) void worker.terminate();
  }

  private requestScan(modulePath: string): Promise<AppDiscoveryEntry[]> {
    const worker = this.ensureWorker();
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, modulePath });
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./app-discovery-worker.js', import.meta.url));
    worker.unref();
    worker.on('message', (response: WorkerResponse) => {
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error));
      else request.resolve(response.apps ?? []);
    });
    worker.on('error', (error) => this.handleWorkerFailure(error));
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (code !== 0) this.handleWorkerFailure(new Error(`Attune app discovery worker exited with code ${code}.`));
    });
    this.worker = worker;
    return worker;
  }

  private handleWorkerFailure(error: Error): void {
    this.worker = null;
    this.inFlight = null;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
