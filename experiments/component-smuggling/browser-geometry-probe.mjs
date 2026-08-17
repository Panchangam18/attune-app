const port = Number(process.argv[2] || 63331);
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page' && /^https?:/.test(target.url));
if (!page?.webSocketDebuggerUrl) throw new Error(`No web page target on port ${port}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  resolver(message);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`${method} timed out`));
  }, 3000);
  pending.set(id, (message) => {
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  socket.send(JSON.stringify({ id, method, params }));
});

const [windowResult, runtimeResult, layoutResult] = await Promise.all([
  send('Browser.getWindowForTarget'),
  send('Runtime.evaluate', {
    expression: `({
      screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight,
      devicePixelRatio,
      visualViewport: visualViewport && {
        width: visualViewport.width,
        height: visualViewport.height,
        scale: visualViewport.scale,
        offsetLeft: visualViewport.offsetLeft,
        offsetTop: visualViewport.offsetTop,
      },
    })`,
    returnByValue: true,
  }),
  send('Page.getLayoutMetrics'),
]);

console.log(JSON.stringify({
  target: { id: page.id, title: page.title, url: page.url },
  browserWindow: windowResult,
  pageWindow: runtimeResult.result.value,
  cssLayoutViewport: layoutResult.cssLayoutViewport,
  cssVisualViewport: layoutResult.cssVisualViewport,
}, null, 2));
socket.close();
