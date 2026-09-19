import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CredentialVaultPort, CredentialId } from '../../application/ports/CredentialVaultPort';

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ElectronSafeStorageCredentialVault implements CredentialVaultPort {
  constructor(private readonly directory: string, private readonly safeStorage: SafeStoragePort) {}

  async set(id: CredentialId, secret: string): Promise<void> {
    this.requireEncryption();
    const encrypted = this.safeStorage.encryptString(secret);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.pathFor(id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async get(id: CredentialId): Promise<string | null> {
    this.requireEncryption();
    try {
      return this.safeStorage.decryptString(await fs.readFile(this.pathFor(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('Encrypted credential could not be read', { cause: error });
    }
  }

  async delete(id: CredentialId): Promise<void> {
    await fs.rm(this.pathFor(id), { force: true });
  }

  private requireEncryption(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('OS-backed credential encryption is unavailable');
    }
  }

  private pathFor(id: CredentialId): string {
    const filename = createHash('sha256').update(id).digest('hex');
    return path.join(this.directory, `${filename}.bin`);
  }
}
