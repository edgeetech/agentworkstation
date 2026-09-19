export type VerifiedArticle = Readonly<{
  publicationUrl: string;
  status: number;
}>;

export interface PublicationHttpVerifier {
  verify(publicationUrl: string, signal: AbortSignal): Promise<VerifiedArticle>;
}

export type PublicationHttpResponse = Readonly<{
  status: number;
  url: string;
}>;

export interface PublicationHttpClient {
  getExact(url: string, signal: AbortSignal): Promise<PublicationHttpResponse>;
}

export class FetchPublicationHttpClient implements PublicationHttpClient {
  async getExact(url: string, signal: AbortSignal): Promise<PublicationHttpResponse> {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal });
    return { status: response.status, url: response.url };
  }
}

function requireExactHttpsArticleUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Article URL must be an absolute HTTPS URL');
  }
  if (
    parsed.protocol !== 'https:'
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Article URL must be an exact HTTPS URL without credentials, query, or fragment');
  }
  return parsed.toString();
}

export class ExactHttpPublicationVerifier implements PublicationHttpVerifier, SitePublicationVerifier {
  constructor(private readonly client: PublicationHttpClient = new FetchPublicationHttpClient()) {}

  async verify(
    request: string | SitePublicationVerificationRequest,
    signal: AbortSignal,
  ): Promise<VerifiedArticle> {
    signal.throwIfAborted();
    const publicationUrl = typeof request === 'string' ? request : request.publicationUrl;
    const expectedUrl = requireExactHttpsArticleUrl(publicationUrl);
    const response = await this.client.getExact(expectedUrl, signal);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Article URL did not return a successful response (HTTP ${response.status})`);
    }
    if (requireExactHttpsArticleUrl(response.url) !== expectedUrl) {
      throw new Error('Successful response URL does not exactly match the requested article URL');
    }
    return Object.freeze({ publicationUrl: expectedUrl, status: response.status });
  }
}
import type {
  SitePublicationVerificationRequest,
  SitePublicationVerifier,
} from '../../application/publication/publishers';
