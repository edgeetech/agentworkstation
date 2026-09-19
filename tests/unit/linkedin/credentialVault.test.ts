import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ElectronSafeStorageCredentialVault } from '../../../src/infrastructure/linkedin/ElectronSafeStorageCredentialVault';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('ElectronSafeStorageCredentialVault', () => {
  it('writes only OS-encrypted ciphertext and can delete it', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aw-linkedin-vault-'));
    directories.push(directory);
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`cipher:${Buffer.from(value).toString('base64')}`),
      decryptString: (value: Buffer) => Buffer.from(value.toString().slice(7), 'base64').toString(),
    };
    const vault = new ElectronSafeStorageCredentialVault(directory, safeStorage);
    await vault.set('linkedin-token', 'plain-access-token');
    const files = await import('node:fs/promises').then((fs) => fs.readdir(directory));
    expect(files).toHaveLength(1);
    expect((await readFile(path.join(directory, files[0]!))).toString()).not.toContain('plain-access-token');
    expect(await vault.get('linkedin-token')).toBe('plain-access-token');
    await vault.delete('linkedin-token');
    expect(await vault.get('linkedin-token')).toBeNull();
  });

  it('fails closed without OS encryption and writes nothing', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aw-linkedin-vault-'));
    directories.push(directory);
    const vault = new ElectronSafeStorageCredentialVault(directory, {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('must not encrypt'); },
      decryptString: () => { throw new Error('must not decrypt'); },
    });
    await expect(vault.set('linkedin-token', 'secret')).rejects.toThrow('encryption is unavailable');
    await expect(vault.get('linkedin-token')).rejects.toThrow('encryption is unavailable');
  });
});
