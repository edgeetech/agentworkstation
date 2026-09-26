import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { UPDATE_READY_CHANNEL, wireUpdateNotifications } from '../../src/infrastructure/updates/updateNotifier';

describe('wireUpdateNotifications', () => {
  it('forwards update-downloaded to the current sender on the update-ready channel', () => {
    const updater = new EventEmitter();
    const send = vi.fn();
    wireUpdateNotifications(updater, () => ({ send }));

    updater.emit('update-downloaded', { version: '1.2.3' });

    expect(send).toHaveBeenCalledWith(UPDATE_READY_CHANNEL, { version: '1.2.3' });
  });

  it('does nothing when no sender is available (e.g. the window was closed)', () => {
    const updater = new EventEmitter();
    const send = vi.fn();
    wireUpdateNotifications(updater, () => null);

    updater.emit('update-downloaded', { version: '1.2.3' });

    expect(send).not.toHaveBeenCalled();
  });

  it('logs updater errors instead of throwing', () => {
    const updater = new EventEmitter();
    const logError = vi.fn();
    wireUpdateNotifications(updater, () => null, logError);

    expect(() => updater.emit('error', new Error('network down'))).not.toThrow();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });

  it('logs non-Error updater failures by stringifying them', () => {
    const updater = new EventEmitter();
    const logError = vi.fn();
    wireUpdateNotifications(updater, () => null, logError);

    updater.emit('error', 'timeout');

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('timeout'));
  });
});
