import { describe, expect, it } from 'vitest';
import { DefaultPlatformService } from '../../src/infrastructure/platform/defaultPlatformService';

describe('platform service', () => {
  it('returns a supported platform kind', () => {
    const service = new DefaultPlatformService();
    expect(['windows', 'macos', 'linux']).toContain(service.getPlatform());
  });

  it('resolves home and app-data directories', async () => {
    const service = new DefaultPlatformService();
    const home = await service.getHomeDirectory();
    const appData = await service.getAppDataDirectory();

    expect(home.length).toBeGreaterThan(0);
    expect(appData.length).toBeGreaterThan(0);
  });
});
