const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

async function renderIcon() {
  await app.whenReady();

  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  await window.loadFile(join(__dirname, '..', 'build', 'icon.html'));
  await window.webContents.executeJavaScript(`
    (async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })();
  `);
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  await writeFile(join(__dirname, '..', 'build', 'icon.png'), image.toPNG());
  await app.quit();
}

renderIcon().catch((error) => {
  console.error(error);
  app.exit(1);
});
