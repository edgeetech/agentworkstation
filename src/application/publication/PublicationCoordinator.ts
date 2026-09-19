import {
  approveLinkedInShare,
  approveSitePublication,
  createPublicationWorkflow,
  recordLinkedInShareExecution,
  recordSitePublicationExecution,
  requestLinkedInApproval,
  verifyLinkedInShare,
  verifySitePublication,
  type AuditIdentity,
  type LinkedInShareApprovalRequest,
  type PublicationBundle,
  type PublicationWorkflow,
} from '../../domain/publication/workflow';
import type {
  LinkedInConnectionReference,
  PublicationSiteTarget,
} from '../../domain/publication/configuration';
import type { PublicationPersistence } from './persistence';
import { assertArchivablePublicationWorkflow } from './persistence';
import {
  buildLinkedInShareRequest,
  buildLinkedInShareVerificationRequest,
  buildSitePublicationRequest,
  buildSitePublicationVerificationRequest,
  type LinkedInPublisher,
  type LinkedInShareVerifier,
  type SitePublisher,
  type SitePublicationVerifier,
} from './publishers';

export type StartPublicationInput = Readonly<{
  id: string;
  bundle: PublicationBundle;
  target: PublicationSiteTarget;
  linkedInConnection?: LinkedInConnectionReference;
  requestedBy: AuditIdentity;
}>;

export class PublicationCoordinator {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: PublicationPersistence,
    private readonly sitePublisher: SitePublisher,
    private readonly siteVerifier: SitePublicationVerifier,
    private readonly linkedInPublisher: LinkedInPublisher,
    private readonly linkedInVerifier: LinkedInShareVerifier,
  ) {}

  async start(input: StartPublicationInput): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () => {
      const existing = await this.persistence.getActiveWorkflow();
      if (existing) throw new Error(`Publication workflow ${existing.id} is already active`);
      return this.save(createPublicationWorkflow(input));
    });
  }

  async approveSite(identity: AuditIdentity): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () =>
      this.save(approveSitePublication(await this.requireActiveWorkflow(), identity)));
  }

  async publish(
    executionIdentity: AuditIdentity,
    verificationIdentity: AuditIdentity,
    signal: AbortSignal,
  ): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () => {
      const workflow = await this.requireActiveWorkflow();
      const result = await this.sitePublisher.publish(buildSitePublicationRequest(workflow), signal);
      const awaitingVerification = await this.save(
        recordSitePublicationExecution(workflow, result, executionIdentity),
      );
      return this.verifySiteAttempt(awaitingVerification, verificationIdentity, signal);
    });
  }

  async retrySiteVerification(
    identity: AuditIdentity,
    signal: AbortSignal,
  ): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () =>
      this.verifySiteAttempt(await this.requireActiveWorkflow(), identity, signal));
  }

  async archiveCompleted(): Promise<void> {
    return this.serializeMutation(async () => {
      const workflow = await this.requireActiveWorkflow();
      assertArchivablePublicationWorkflow(workflow);
      await this.persistence.archiveActiveWorkflow(workflow);
    });
  }

  async requestLinkedInApproval(
    request: LinkedInShareApprovalRequest,
    identity: AuditIdentity,
  ): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () =>
      this.save(requestLinkedInApproval(await this.requireActiveWorkflow(), request, identity)));
  }

  async approveLinkedIn(identity: AuditIdentity): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () =>
      this.save(approveLinkedInShare(await this.requireActiveWorkflow(), identity)));
  }

  async share(
    executionIdentity: AuditIdentity,
    verificationIdentity: AuditIdentity,
    signal: AbortSignal,
  ): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () => {
      const workflow = await this.requireActiveWorkflow();
      const result = await this.linkedInPublisher.share(buildLinkedInShareRequest(workflow), signal);
      const awaitingVerification = await this.save(
        recordLinkedInShareExecution(workflow, result, executionIdentity),
      );
      return this.verifyLinkedInAttempt(awaitingVerification, verificationIdentity, signal);
    });
  }

  async retryLinkedInVerification(
    identity: AuditIdentity,
    signal: AbortSignal,
  ): Promise<PublicationWorkflow> {
    return this.serializeMutation(async () =>
      this.verifyLinkedInAttempt(await this.requireActiveWorkflow(), identity, signal));
  }

  private async verifySiteAttempt(
    workflow: PublicationWorkflow,
    identity: AuditIdentity,
    signal: AbortSignal,
  ): Promise<PublicationWorkflow> {
    await this.siteVerifier.verify(buildSitePublicationVerificationRequest(workflow), signal);
    return this.save(verifySitePublication(workflow, identity));
  }

  private async verifyLinkedInAttempt(
    workflow: PublicationWorkflow,
    identity: AuditIdentity,
    signal: AbortSignal,
  ): Promise<PublicationWorkflow> {
    await this.linkedInVerifier.verify(buildLinkedInShareVerificationRequest(workflow), signal);
    return this.save(verifyLinkedInShare(workflow, identity));
  }

  private async requireActiveWorkflow(): Promise<PublicationWorkflow> {
    const workflow = await this.persistence.getActiveWorkflow();
    if (!workflow) throw new Error('No active publication workflow exists');
    return workflow;
  }

  private async save(workflow: PublicationWorkflow): Promise<PublicationWorkflow> {
    await this.persistence.saveActiveWorkflow(workflow);
    return workflow;
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
