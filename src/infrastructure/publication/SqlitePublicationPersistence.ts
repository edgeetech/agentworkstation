import {
  PublicationPersistenceDiagnostic,
  assertArchivablePublicationWorkflow,
  type PublicationPersistence,
  type PublicationSettingStore,
  validateLinkedInConnectionReference,
  validateLinkedInPublisherConfiguration,
  validatePublicationSiteTarget,
  validatePublicationWorkflow,
} from '../../application/publication/persistence';
import type {
  LinkedInConnectionReference,
  LinkedInPublisherConfiguration,
  PublicationSiteTarget,
} from '../../domain/publication/configuration';
import type { PublicationWorkflow } from '../../domain/publication/workflow';

const SITE_TARGET_KEY = 'publication.siteTarget';
const LINKEDIN_CONNECTION_KEY = 'publication.linkedInConnectionReference';
const LINKEDIN_CONFIGURATION_KEY = 'publication.linkedInPublisherConfiguration';
const ACTIVE_WORKFLOW_KEY = 'publication.activeWorkflow';
const WORKFLOW_HISTORY_KEY = 'publication.workflowHistory';
const MAX_WORKFLOW_HISTORY = 20;

type Validator<T> = (value: unknown) => T;

export class SqlitePublicationPersistence implements PublicationPersistence {
  constructor(private readonly settings: PublicationSettingStore) {}

  async getSiteTarget(): Promise<PublicationSiteTarget | null> {
    return this.readValidated(SITE_TARGET_KEY, validatePublicationSiteTarget);
  }

  async saveSiteTarget(target: PublicationSiteTarget): Promise<void> {
    await this.writeValidated(SITE_TARGET_KEY, target, validatePublicationSiteTarget);
  }

  async clearSiteTarget(): Promise<void> {
    await this.settings.setSetting(SITE_TARGET_KEY, '');
  }

  async getLinkedInConnectionReference(): Promise<LinkedInConnectionReference | null> {
    return this.readValidated(LINKEDIN_CONNECTION_KEY, validateLinkedInConnectionReference);
  }

  async saveLinkedInConnectionReference(reference: LinkedInConnectionReference): Promise<void> {
    await this.writeValidated(
      LINKEDIN_CONNECTION_KEY,
      reference,
      validateLinkedInConnectionReference,
    );
  }

  async clearLinkedInConnectionReference(): Promise<void> {
    await this.settings.setSetting(LINKEDIN_CONNECTION_KEY, '');
  }

  async getLinkedInPublisherConfiguration(): Promise<LinkedInPublisherConfiguration | null> {
    return this.readValidated(LINKEDIN_CONFIGURATION_KEY, validateLinkedInPublisherConfiguration);
  }

  async saveLinkedInPublisherConfiguration(configuration: LinkedInPublisherConfiguration): Promise<void> {
    await this.writeValidated(LINKEDIN_CONFIGURATION_KEY, configuration, validateLinkedInPublisherConfiguration);
  }

  async clearLinkedInPublisherConfiguration(): Promise<void> {
    await this.settings.setSetting(LINKEDIN_CONFIGURATION_KEY, '');
  }

  async getActiveWorkflow(): Promise<PublicationWorkflow | null> {
    const stored = await this.settings.getSetting(ACTIVE_WORKFLOW_KEY);
    if (!stored) return null;
    try {
      return validatePublicationWorkflow(JSON.parse(stored) as unknown);
    } catch (error) {
      throw new PublicationPersistenceDiagnostic(
        ACTIVE_WORKFLOW_KEY,
        'The persisted publication workflow is malformed and can be repaired or cleared',
        { cause: error },
      );
    }
  }

  async saveActiveWorkflow(workflow: PublicationWorkflow): Promise<void> {
    await this.writeValidated(ACTIVE_WORKFLOW_KEY, workflow, validatePublicationWorkflow);
  }

  async getWorkflowHistory(): Promise<readonly PublicationWorkflow[]> {
    const stored = await this.settings.getSetting(WORKFLOW_HISTORY_KEY);
    if (!stored) return Object.freeze([]);
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Publication history must be an array');
      return Object.freeze(parsed.map(validatePublicationWorkflow));
    } catch (error) {
      throw new PublicationPersistenceDiagnostic(
        WORKFLOW_HISTORY_KEY,
        'The persisted publication history is malformed and requires repair',
        { cause: error },
      );
    }
  }

  async archiveActiveWorkflow(workflow: PublicationWorkflow): Promise<void> {
    const validated = validatePublicationWorkflow(workflow);
    assertArchivablePublicationWorkflow(validated);
    const active = await this.getActiveWorkflow();
    if (!active || active.id !== validated.id || JSON.stringify(active) !== JSON.stringify(validated)) {
      throw new Error('Only the exact active publication workflow can be archived');
    }
    const history = await this.getWorkflowHistory();
    const bounded = [validated, ...history.filter(({ id }) => id !== validated.id)]
      .slice(0, MAX_WORKFLOW_HISTORY);
    await this.settings.setSetting(WORKFLOW_HISTORY_KEY, JSON.stringify(bounded));
    await this.settings.setSetting(ACTIVE_WORKFLOW_KEY, '');
  }

  private async readValidated<T>(key: string, validate: Validator<T>): Promise<T | null> {
    const stored = await this.settings.getSetting(key);
    if (!stored) return null;
    try {
      return validate(JSON.parse(stored) as unknown);
    } catch {
      return null;
    }
  }

  private async writeValidated<T>(key: string, value: unknown, validate: Validator<T>): Promise<void> {
    const validated = validate(value);
    await this.settings.setSetting(key, JSON.stringify(validated));
  }
}
