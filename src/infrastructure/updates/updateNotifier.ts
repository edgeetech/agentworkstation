/**
 * Wires an electron-updater-like emitter to a renderer sender without importing
 * `electron-updater` or `electron` here, so this module loads (and is unit-tested)
 * without pulling Electron into vitest.
 */
export type UpdateEventEmitter = {
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
};

export type UpdateReadySender = {
  send(channel: string, payload: { version: string }): void;
};

export const UPDATE_READY_CHANNEL = 'agentWorkstation:updateReady';

export function wireUpdateNotifications(
  updater: UpdateEventEmitter,
  getSender: () => UpdateReadySender | null,
  logError: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): void {
  updater.on('update-downloaded', (info) => {
    const sender = getSender();
    if (!sender) return;
    sender.send(UPDATE_READY_CHANNEL, { version: info.version });
  });
  updater.on('error', (error) => {
    logError(`Auto-update error: ${error instanceof Error ? error.message : String(error)}`);
  });
}
