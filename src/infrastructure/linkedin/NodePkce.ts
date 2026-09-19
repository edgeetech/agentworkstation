import { createHash, randomBytes } from 'node:crypto';
import type { PkcePort } from '../../application/linkedin/connection';

export class NodePkce implements PkcePort {
  randomUrlSafe(size: number): string {
    return randomBytes(size).toString('base64url');
  }

  sha256UrlSafe(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }
}
