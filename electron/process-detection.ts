export function processListHasExecutable(
  processList: string,
  executablePath: string,
): boolean {
  return processList
    .split('\n')
    .map(command => command.trim())
    .some(command => (
      command === executablePath
      || command.startsWith(`${executablePath} `)
    ));
}
