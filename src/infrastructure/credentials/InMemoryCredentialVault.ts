import type { CredentialVaultPort, CredentialId } from '@application/ports/CredentialVaultPort';

export class InMemoryCredentialVault implements CredentialVaultPort {
  private readonly store = new Map<CredentialId, string>();

  async set(id: CredentialId, secret: string): Promise<void> {
    this.store.set(id, secret);
  }

  async get(id: CredentialId): Promise<string | null> {
    return this.store.get(id) ?? null;
  }

  async delete(id: CredentialId): Promise<void> {
    this.store.delete(id);
  }
}
