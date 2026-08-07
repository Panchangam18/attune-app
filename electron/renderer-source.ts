export function selectRendererDevServerUrl(
  packaged: boolean,
  configuredUrl = process.env.ATTUNE_APP_DEV_SERVER_URL,
): string | undefined {
  return packaged ? undefined : configuredUrl;
}
