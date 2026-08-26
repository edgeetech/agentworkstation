import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { PlatformKind, PlatformService } from '@application/platform';

function currentPlatform(): PlatformKind {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

export class DefaultPlatformService implements PlatformService {
  getPlatform(): PlatformKind {
    return currentPlatform();
  }

  async getAppDataDirectory(): Promise<string> {
    const platform = this.getPlatform();
    const home = await this.getHomeDirectory();
    const directory = platform === 'windows'
      ? path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'AgentWorkstation')
      : platform === 'macos'
        ? path.join(home, 'Library', 'Application Support', 'AgentWorkstation')
        : path.join(home, '.local', 'share', 'agentworkstation');
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }

  async getHomeDirectory(): Promise<string> {
    return os.homedir();
  }
}
