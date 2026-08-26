export type CredentialId = string;

export interface CredentialVaultPort {
  set(id: CredentialId, secret: string): Promise<void>;
  get(id: CredentialId): Promise<string | null>;
  delete(id: CredentialId): Promise<void>;
}
