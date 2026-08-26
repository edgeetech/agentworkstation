import { buildDeterministicCareerAuditScenario } from '../../../src/application/careerAuditScenario';

type CareerAuditApi = {
  getDemoAudit: () => Promise<ReturnType<typeof buildDeterministicCareerAuditScenario>>;
};

declare global {
  interface Window {
    agentWorkstation?: CareerAuditApi;
  }
}

window.agentWorkstation = {
  getDemoAudit: async () => buildDeterministicCareerAuditScenario(),
};

