export type PlatformKind = 'windows' | 'macos' | 'linux';

export interface PlatformService {
  getAppDataDirectory(): Promise<string>;
  getHomeDirectory(): Promise<string>;
  getPlatform(): PlatformKind;
}
