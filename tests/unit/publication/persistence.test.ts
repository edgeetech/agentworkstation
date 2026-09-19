import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createLinkedInConnectionReference,
  createLinkedInPublisherConfiguration,
  createPublicationSiteTarget,
} from '../../../src/domain/publication/configuration';
import {
  approveLinkedInShare,
  approveSitePublication,
  createPublicationWorkflow,
  createPublicationBundle,
  recordLinkedInShareExecution,
  recordSitePublicationExecution,
  requestLinkedInApproval,
  verifySitePublication,
} from '../../../src/domain/publication/workflow';
import { SqlitePublicationPersistence } from '../../../src/infrastructure/publication/SqlitePublicationPersistence';
import { PublicationPersistenceDiagnostic } from '../../../src/application/publication/persistence';
import { SqlitePersistence } from '../../../src/infrastructure/persistence/sqlite';

function createStore(): { settings: SqlitePersistence; store: SqlitePublicationPersistence } {
  const file = path.join(os.tmpdir(), `aw-publication-${crypto.randomUUID()}.db`);
  const settings = new SqlitePersistence(file);
  return { settings, store: new SqlitePublicationPersistence(settings) };
}

const target = createPublicationSiteTarget({
  displayDomain: 'blog.example.com',
  workspaceId: 'blog-workspace',
  contentDirectory: 'content/articles',
  publishBranch: 'main',
  publicBaseUrl: 'https://blog.example.com/articles',
});

function bundle(contentId: string) {
  return createPublicationBundle({
    contentId,
    primaryArticlePath: `content/articles/${contentId}.md`,
    artifacts: [
      { path: `content/articles/${contentId}.md`, sha256: 'a'.repeat(64), role: 'primary-article' },
      { path: `content/articles/${contentId}.tr.md`, sha256: 'b'.repeat(64), role: 'translation' },
    ],
  });
}

describe('SqlitePublicationPersistence', () => {
  it('round-trips and clears validated immutable site and LinkedIn configuration', async () => {
    const { store } = createStore();
    const connection = createLinkedInConnectionReference('linkedin:connection/team-account');
    const publisherConfiguration = createLinkedInPublisherConfiguration({ clientId: 'public-client', apiVersion: '202608' });

    await store.saveSiteTarget(target);
    await store.saveLinkedInConnectionReference(connection);
    await store.saveLinkedInPublisherConfiguration(publisherConfiguration);

    const loadedTarget = await store.getSiteTarget();
    const loadedConnection = await store.getLinkedInConnectionReference();
    const loadedPublisherConfiguration = await store.getLinkedInPublisherConfiguration();
    expect(loadedTarget).toEqual(target);
    expect(loadedConnection).toEqual(connection);
    expect(loadedPublisherConfiguration).toEqual(publisherConfiguration);
    expect(Object.isFrozen(loadedTarget)).toBe(true);
    expect(Object.isFrozen(loadedConnection)).toBe(true);
    expect(Object.isFrozen(loadedPublisherConfiguration)).toBe(true);

    await store.clearSiteTarget();
    await store.clearLinkedInConnectionReference();
    await store.clearLinkedInPublisherConfiguration();
    await expect(store.getSiteTarget()).resolves.toBeNull();
    await expect(store.getLinkedInConnectionReference()).resolves.toBeNull();
    await expect(store.getLinkedInPublisherConfiguration()).resolves.toBeNull();
  });

  it('round-trips an active workflow by replaying its validated audit trail', async () => {
    const { store } = createStore();
    let workflow = createPublicationWorkflow({
      id: 'publication-1',
      bundle: bundle('post-1'),
      target,
      requestedBy: { actorLabel: 'Author', at: '2026-09-10T10:00:00.000Z' },
    });
    workflow = approveSitePublication(workflow, {
      actorLabel: 'Reviewer',
      at: '2026-09-10T10:01:00.000Z',
    });
    workflow = recordSitePublicationExecution(workflow, {
      publicationUrl: 'https://blog.example.com/articles/post-1',
      publisherReference: 'site:deployment/42',
    }, {
      actorLabel: 'Publisher',
      at: '2026-09-10T10:02:00.000Z',
    });
    workflow = verifySitePublication(workflow, {
      actorLabel: 'Verifier',
      at: '2026-09-10T10:03:00.000Z',
    });

    await store.saveActiveWorkflow(workflow);
    const loaded = await store.getActiveWorkflow();

    expect(loaded).toEqual(workflow);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded?.target)).toBe(true);
    expect(Object.isFrozen(loaded?.auditTrail)).toBe(true);
    expect(Object.isFrozen(loaded?.sitePublicationAttempt)).toBe(true);
    expect(Object.isFrozen(loaded?.sitePublication)).toBe(true);
  });

  it('archives the exact completed active workflow and clears only after retaining history', async () => {
    const { store } = createStore();
    let workflow = createPublicationWorkflow({
      id: 'publication-archive', bundle: bundle('post-archive'), target,
      requestedBy: { actorLabel: 'Author', at: '2026-09-10T10:00:00.000Z' },
    });
    workflow = approveSitePublication(workflow, { actorLabel: 'Reviewer', at: '2026-09-10T10:01:00.000Z' });
    workflow = recordSitePublicationExecution(workflow, {
      publicationUrl: 'https://blog.example.com/articles/post-archive',
      publisherReference: 'site:deployment/archive',
    }, { actorLabel: 'Publisher', at: '2026-09-10T10:02:00.000Z' });
    workflow = verifySitePublication(workflow, { actorLabel: 'Verifier', at: '2026-09-10T10:03:00.000Z' });
    await store.saveActiveWorkflow(workflow);

    await store.archiveActiveWorkflow(workflow);

    await expect(store.getActiveWorkflow()).resolves.toBeNull();
    await expect(store.getWorkflowHistory()).resolves.toEqual([workflow]);
  });

  it('replays both durable awaiting-verification attempts', async () => {
    const { store } = createStore();
    const linkedInConnection = createLinkedInConnectionReference('linkedin:connection/team-account');
    let workflow = createPublicationWorkflow({
      id: 'publication-awaiting',
      bundle: bundle('post-2'),
      target,
      linkedInConnection,
      requestedBy: { actorLabel: 'Author', at: '2026-09-10T10:00:00.000Z' },
    });
    workflow = approveSitePublication(workflow, {
      actorLabel: 'Reviewer', at: '2026-09-10T10:01:00.000Z',
    });
    workflow = recordSitePublicationExecution(workflow, {
      publicationUrl: 'https://blog.example.com/articles/post-2',
      publisherReference: 'site:deployment/43',
    }, { actorLabel: 'Publisher', at: '2026-09-10T10:02:00.000Z' });

    await store.saveActiveWorkflow(workflow);
    const siteAwaiting = await store.getActiveWorkflow();
    expect(siteAwaiting).toEqual(workflow);
    expect(siteAwaiting?.stage).toBe('SITE_PUBLICATION_AWAITING_VERIFICATION');

    workflow = verifySitePublication(workflow, {
      actorLabel: 'Verifier', at: '2026-09-10T10:03:00.000Z',
    });
    workflow = requestLinkedInApproval(workflow, {
      commentary: 'Exact commentary',
      publicationUrl: 'https://blog.example.com/articles/post-2',
      authorUrn: 'urn:li:person:member-123',
      memberSubject: 'member-123',
    }, {
      actorLabel: 'Owner', at: '2026-09-10T10:04:00.000Z',
    });
    workflow = approveLinkedInShare(workflow, {
      actorLabel: 'Social reviewer', at: '2026-09-10T10:05:00.000Z',
    });
    workflow = recordLinkedInShareExecution(workflow, {
      publisherReference: 'linkedin:activity:100',
      shareUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:100',
    }, { actorLabel: 'Social publisher', at: '2026-09-10T10:06:00.000Z' });

    await store.saveActiveWorkflow(workflow);
    const linkedInAwaiting = await store.getActiveWorkflow();
    expect(linkedInAwaiting).toEqual(workflow);
    expect(linkedInAwaiting?.stage).toBe('LINKEDIN_SHARE_AWAITING_VERIFICATION');
    expect(Object.isFrozen(linkedInAwaiting?.linkedInShareAttempt)).toBe(true);
  });

  it('fails closed for malformed configuration and surfaces malformed workflow state', async () => {
    const { settings, store } = createStore();

    await settings.setSetting('publication.siteTarget', '{not-json');
    await expect(store.getSiteTarget()).resolves.toBeNull();

    await settings.setSetting('publication.siteTarget', JSON.stringify({
      displayDomain: 'https://blog.example.com/private',
      workspaceId: 'blog-workspace',
      contentDirectory: 'content',
    }));
    await expect(store.getSiteTarget()).resolves.toBeNull();

    await settings.setSetting('publication.activeWorkflow', JSON.stringify({
      id: 'forged',
      contentId: 'post',
      target,
      stage: 'SITE_APPROVED',
      auditTrail: [{
        action: 'SITE_APPROVAL_REQUESTED',
        actorLabel: 'Author',
        at: '2026-09-10T10:00:00.000Z',
      }],
    }));
    const diagnostic = await store.getActiveWorkflow().catch((error: unknown) => error);
    expect(diagnostic).toBeInstanceOf(PublicationPersistenceDiagnostic);
    expect(diagnostic).toMatchObject({
      code: 'MALFORMED_PERSISTED_PUBLICATION_STATE',
      recoverable: true,
      key: 'publication.activeWorkflow',
    });
  });

  it('validates before writing and never persists secret-like fields or values', async () => {
    const { settings, store } = createStore();
    const invalid = {
      ...target,
      apiToken: 'sk-abcdefghijklmnop',
    };

    await expect(store.saveSiteTarget(invalid as typeof target)).rejects.toThrow(/secret-like|Secret-like/);
    await expect(settings.getSetting('publication.siteTarget')).resolves.toBeNull();

    await expect(store.saveLinkedInConnectionReference({
      reference: 'sk-abcdefghijklmnop',
    })).rejects.toThrow(/credentials|non-secret/);
    await expect(settings.getSetting('publication.linkedInConnectionReference')).resolves.toBeNull();
  });
});
