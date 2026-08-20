import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import type { RuntimeKind } from './types.js';

interface DiscoveredApp {
  name: string;
  path: string;
  bundleId: string | null;
  runtime: RuntimeKind;
}

interface ScanModule {
  scanForSupportedApps(): DiscoveredApp[];
  getAppId(appInfo: DiscoveredApp): string;
  getAppExecutablePath(appInfo: DiscoveredApp): string;
}

interface ScanRequest {
  id: number;
  modulePath: string;
}

if (!parentPort) throw new Error('The Attune app discovery worker requires a parent port.');

parentPort.on('message', async (request: ScanRequest) => {
  try {
    const scanModule = await import(pathToFileURL(request.modulePath).href) as ScanModule;
    const apps = scanModule.scanForSupportedApps().map((appInfo) => ({
      ...appInfo,
      appId: scanModule.getAppId(appInfo),
      executablePath: scanModule.getAppExecutablePath(appInfo),
    }));
    parentPort!.postMessage({ id: request.id, apps });
  } catch (error) {
    parentPort!.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
