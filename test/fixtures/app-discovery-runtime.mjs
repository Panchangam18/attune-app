const pause = new Int32Array(new SharedArrayBuffer(4));

export function scanForSupportedApps() {
  Atomics.wait(pause, 0, 0, 180);
  return [{
    name: 'Fixture App',
    path: '/Applications/Fixture App.app',
    bundleId: 'com.attune.fixture',
    runtime: 'electron',
  }];
}

export function getAppId(app) {
  return app.bundleId;
}

export function getAppExecutablePath(app) {
  return `${app.path}/Contents/MacOS/Fixture App`;
}
