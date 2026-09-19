import { describe, expect, it } from 'vitest';
import {
  createLinkedInConnectionReference,
  createLinkedInPublisherConfiguration,
  createPublicationSiteTarget,
} from '../../../src/domain/publication/configuration';

describe('publication configuration', () => {
  it('creates a normalized, immutable site target containing only public configuration', () => {
    const target = createPublicationSiteTarget({
      displayDomain: 'Blog.Example.com',
      workspaceId: 'blog-workspace',
      contentDirectory: 'content\\articles',
      publishBranch: 'main',
      approvedAssetDirectories: ['public\\images'],
      publicBaseUrl: 'https://blog.example.com/articles/',
    });

    expect(target).toEqual({
      displayDomain: 'blog.example.com',
      workspaceId: 'blog-workspace',
      contentDirectory: 'content/articles',
      publishBranch: 'main',
      approvedAssetDirectories: ['public/images'],
      publicBaseUrl: 'https://blog.example.com/articles',
    });
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target.approvedAssetDirectories)).toBe(true);
  });

  it.each([
    '/var/content',
    '\\server\\share',
    'C:\\content',
    '../content',
    'content/../private',
    'content/./articles',
  ])('rejects unsafe content directory %s', (contentDirectory) => {
    expect(() => createPublicationSiteTarget({
      displayDomain: 'blog.example.com',
      workspaceId: 'blog-workspace',
      contentDirectory,
    })).toThrow(/relative|traversal/);
  });

  it.each(['apiKey', 'access_token', 'client-secret', 'password']) (
    'rejects secret-like configuration key %s',
    (secretKey) => {
      expect(() => createPublicationSiteTarget({
        displayDomain: 'blog.example.com',
        workspaceId: 'blog-workspace',
        contentDirectory: 'content',
        [secretKey]: 'do-not-store',
      })).toThrow('Secret-like configuration key');
    },
  );

  it('rejects unknown configuration rather than silently retaining it', () => {
    expect(() => createPublicationSiteTarget({
      displayDomain: 'blog.example.com',
      workspaceId: 'blog-workspace',
      contentDirectory: 'content',
      deploymentRegion: 'eu-west',
    })).toThrow('Unknown site target configuration key');
  });

  it.each([
    ['workspaceId', 'token=super-secret-value'],
    ['contentDirectory', 'content/password=hunter2'],
    ['publicBaseUrl', 'https://user:password@blog.example.com/articles'],
  ])('rejects secret-like %s values', (key, value) => {
    expect(() => createPublicationSiteTarget({
      displayDomain: 'blog.example.com',
      workspaceId: 'blog-workspace',
      contentDirectory: 'content',
      publishBranch: 'main',
      [key]: value,
    })).toThrow(/credentials|non-secret|HTTPS URL/);
  });

  it.each([
    'http://blog.example.com/articles',
    'https://other.example.com/articles',
    'https://blog.example.com/articles?preview=true',
    'not-a-url',
  ])('rejects invalid public base URL %s', (publicBaseUrl) => {
    expect(() => createPublicationSiteTarget({
      displayDomain: 'blog.example.com',
      workspaceId: 'blog-workspace',
      contentDirectory: 'content',
      publishBranch: 'main',
      publicBaseUrl,
    })).toThrow(/publicBaseUrl/);
  });

  it.each(['../main', 'feature//publish', 'feature/../main', 'release.lock', 'bad branch'])
  ('rejects unsafe publish branch %s', (publishBranch) => {
    expect(() => createPublicationSiteTarget({
      displayDomain: 'blog.example.com',
      workspaceId: 'blog-workspace',
      contentDirectory: 'content',
      publishBranch,
    })).toThrow('conservative Git branch name');
  });

  it('rejects unsafe or duplicate approved asset directories', () => {
    expect(() => createPublicationSiteTarget({
      displayDomain: 'blog.example.com', workspaceId: 'blog-workspace',
      contentDirectory: 'content', publishBranch: 'main',
      approvedAssetDirectories: ['public/images', '../outside'],
    })).toThrow(/traversal|relative/u);
    expect(() => createPublicationSiteTarget({
      displayDomain: 'blog.example.com', workspaceId: 'blog-workspace',
      contentDirectory: 'content', publishBranch: 'main',
      approvedAssetDirectories: ['public/images', 'public/images'],
    })).toThrow('must be unique');
  });

  it('stores a connection reference but rejects credentials in its place', () => {
    const connection = createLinkedInConnectionReference('linkedin:connection/team-account');

    expect(connection).toEqual({ reference: 'linkedin:connection/team-account' });
    expect(Object.isFrozen(connection)).toBe(true);
    expect(() => createLinkedInConnectionReference('Bearer abcdefghijklmnop'))
      .toThrow('credentials are not allowed');
    expect(() => createLinkedInConnectionReference('sk-abcdefghijklmnop'))
      .toThrow('credentials are not allowed');
  });

  it('keeps the public client ID separate from an explicit validated API version', () => {
    const configuration = createLinkedInPublisherConfiguration({ clientId: 'public-client_1', apiVersion: '202608' });
    expect(configuration).toEqual({ clientId: 'public-client_1', apiVersion: '202608' });
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(() => createLinkedInPublisherConfiguration({ clientId: 'client', apiVersion: 'latest' })).toThrow('YYYYMM');
    expect(() => createLinkedInPublisherConfiguration({ clientId: 'client', apiVersion: '202613' })).toThrow('month');
    expect(() => createLinkedInPublisherConfiguration({
      clientId: 'client', apiVersion: '202608', clientSecret: 'forbidden',
    })).toThrow('Unknown');
  });
});
