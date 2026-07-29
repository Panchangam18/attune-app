import('./external-model-menu-electron.mjs').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
