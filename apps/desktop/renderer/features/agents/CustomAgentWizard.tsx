import { useEffect, useState } from 'react';
import type {
  AgentSummary,
  CustomAgentCapabilities,
  CustomAgentInput,
  CustomAgentSetup,
} from '../../../shared/api';
import { useI18n, type MessageKey } from '../../i18n';
import { Icon } from '../shell/icons';
import { SpecialistAvatar } from './SpecialistAvatar';

type Step = 'identity' | 'instructions' | 'abilities';

const STEPS: Step[] = ['identity', 'instructions', 'abilities'];

const DEFAULT_CAPABILITIES: CustomAgentCapabilities = {
  webResearch: true,
  readFiles: true,
  gitHistory: false,
  proposeFileChanges: false,
  consultSpecialists: true,
};

const messageOf = (value: unknown): string => (value instanceof Error ? value.message : String(value))
  .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

/**
 * Creates or edits a user-defined specialist: who it is, how it works, and which tools
 * and allowed intelligences it may use. Instructions can be drafted by the user's own
 * connected intelligence from a one-paragraph brief.
 */
export function CustomAgentWizard({
  editing,
  onClose,
  onSaved,
}: {
  editing?: { agentId: string; input: CustomAgentInput };
  onClose: () => void;
  onSaved: (agent: AgentSummary) => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const api = window.agentWorkstation;
  const [step, setStep] = useState<Step>(editing ? 'instructions' : 'identity');
  const [setup, setSetup] = useState<CustomAgentSetup | null>(null);
  const [name, setName] = useState(editing?.input.name ?? '');
  const [brief, setBrief] = useState('');
  const [description, setDescription] = useState(editing?.input.description ?? '');
  const [instructions, setInstructions] = useState(editing?.input.instructions ?? '');
  const [rules, setRules] = useState(editing?.input.rules ?? '');
  const [starters, setStarters] = useState((editing?.input.starters ?? []).join('\n'));
  const [capabilities, setCapabilities] = useState<CustomAgentCapabilities>(editing?.input.capabilities ?? DEFAULT_CAPABILITIES);
  const [intelligence, setIntelligence] = useState<string[]>(editing?.input.intelligence ?? []);
  const [working, setWorking] = useState<'draft' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.getCustomAgentSetup().then(setSetup).catch((value: unknown) => setError(messageOf(value)));
  }, [api]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !working) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, working]);

  const draft = (): void => {
    setWorking('draft');
    setError(null);
    void api.draftCustomAgent({ name: name.trim(), brief: brief.trim(), language: locale === 'tr' ? 'tr' : 'en' })
      .then((result) => {
        setDescription(result.description);
        setInstructions(result.instructions);
        setRules(result.rules);
        setStarters(result.starters.join('\n'));
        setStep('instructions');
      })
      .catch((value: unknown) => setError(messageOf(value)))
      .finally(() => setWorking(null));
  };

  const writeMyself = (): void => {
    if (!description.trim()) setDescription(brief.trim().split(/\r?\n/)[0]?.slice(0, 240) ?? '');
    if (!instructions.trim()) setInstructions(`# ${name.trim()}\n\n${brief.trim()}\n`);
    setStep('instructions');
  };

  const save = (): void => {
    const input: CustomAgentInput = {
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      rules: rules.trim(),
      starters: starters.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4),
      capabilities,
      intelligence,
    };
    setWorking('save');
    setError(null);
    const request = editing ? api.updateCustomAgent(editing.agentId, input) : api.createCustomAgent(input);
    void request
      .then(onSaved)
      .catch((value: unknown) => setError(messageOf(value)))
      .finally(() => setWorking(null));
  };

  const options = setup?.intelligenceOptions ?? [];
  const identityReady = name.trim().length > 0 && brief.trim().length > 0;
  const instructionsReady = name.trim().length > 0 && description.trim().length > 0 && instructions.trim().length > 0;
  const toggleCapability = (key: keyof CustomAgentCapabilities): void =>
    setCapabilities((current) => ({ ...current, [key]: !current[key] }));
  const toggleIntelligence = (id: string): void =>
    setIntelligence((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return (
    <div className="palette-backdrop agent-wizard-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
      <section className="agent-wizard" role="dialog" aria-modal="true" aria-labelledby="agent-wizard-title">
        <header className="agent-wizard-header">
          <SpecialistAvatar agentId="custom" name={name.trim() || '?'} />
          <div>
            <h2 id="agent-wizard-title">{editing ? t('wizard.editTitle', { name: editing.input.name }) : t('wizard.title')}</h2>
            <ol className="agent-wizard-steps" aria-label={t('wizard.steps')}>
              {STEPS.map((candidate, index) => (
                <li key={candidate} aria-current={candidate === step ? 'step' : undefined} className={candidate === step ? 'active' : ''}>
                  {index + 1}. {t(`wizard.step.${candidate}` as MessageKey)}
                </li>
              ))}
            </ol>
          </div>
          <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose} disabled={working !== null}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="agent-wizard-body">
          {step === 'identity' ? (
            <>
              <label>
                <span>{t('wizard.name')}</span>
                <input autoFocus maxLength={48} value={name} placeholder={t('wizard.namePlaceholder')} onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                <span>{t('wizard.brief')}</span>
                <textarea rows={5} maxLength={4000} value={brief} placeholder={t('wizard.briefPlaceholder')} onChange={(event) => setBrief(event.target.value)} />
                <small>{t('wizard.briefHelp')}</small>
              </label>
            </>
          ) : null}

          {step === 'instructions' ? (
            <>
              {editing ? (
                <label>
                  <span>{t('wizard.name')}</span>
                  <input maxLength={48} value={name} onChange={(event) => setName(event.target.value)} />
                </label>
              ) : null}
              <label>
                <span>{t('wizard.description')}</span>
                <input maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <label>
                <span>{t('wizard.instructions')}</span>
                <textarea className="mono" rows={10} maxLength={16000} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
              </label>
              <label>
                <span>{t('wizard.rules')}</span>
                <textarea className="mono" rows={4} maxLength={8000} value={rules} placeholder={t('wizard.rulesPlaceholder')} onChange={(event) => setRules(event.target.value)} />
              </label>
              <label>
                <span>{t('wizard.starters')}</span>
                <textarea rows={3} value={starters} placeholder={t('wizard.startersPlaceholder')} onChange={(event) => setStarters(event.target.value)} />
              </label>
            </>
          ) : null}

          {step === 'abilities' ? (
            <>
              <fieldset className="agent-wizard-choices">
                <legend>{t('wizard.capabilities')}</legend>
                {(['webResearch', 'readFiles', 'gitHistory', 'consultSpecialists', 'proposeFileChanges'] as const).map((key) => (
                  <label key={key} className="agent-wizard-choice">
                    <input type="checkbox" checked={capabilities[key]} onChange={() => toggleCapability(key)} />
                    <span>
                      <strong>{t(`wizard.capability.${key}` as MessageKey)}</strong>
                      <small>{t(`wizard.capability.${key}.help` as MessageKey)}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="agent-wizard-choices">
                <legend>{t('wizard.intelligence')}</legend>
                <label className="agent-wizard-choice">
                  <input type="radio" name="agent-intelligence" checked={intelligence.length === 0} onChange={() => setIntelligence([])} />
                  <span>
                    <strong>{t('wizard.intelligenceAuto')}</strong>
                    <small>{t('wizard.intelligenceAutoHelp')}</small>
                  </span>
                </label>
                <label className="agent-wizard-choice">
                  <input type="radio" name="agent-intelligence" checked={intelligence.length > 0} disabled={options.length === 0} onChange={() => setIntelligence(options.slice(0, 1).map((option) => option.id))} />
                  <span>
                    <strong>{t('wizard.intelligenceChoose')}</strong>
                    <small>{options.length === 0 ? t('wizard.intelligenceNone') : t('wizard.intelligenceChooseHelp')}</small>
                  </span>
                </label>
                {intelligence.length > 0 ? (
                  <div className="agent-wizard-options">
                    {options.map((option) => (
                      <label key={option.id}>
                        <input type="checkbox" checked={intelligence.includes(option.id)} onChange={() => toggleIntelligence(option.id)} />
                        <span>{option.label}</span>
                        <em>{option.location === 'local' ? t('wizard.onDevice') : t('wizard.cloud')}</em>
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>
            </>
          ) : null}

          {error ? <p className="agent-wizard-error" role="alert">{error}</p> : null}
        </div>

        <footer className="agent-wizard-footer">
          {step === 'identity' ? (
            <>
              <button type="button" onClick={writeMyself} disabled={!identityReady || working !== null}>{t('wizard.writeMyself')}</button>
              <button type="button" className="primary" onClick={draft} disabled={!identityReady || working !== null || setup?.canDraft === false} title={setup?.canDraft === false ? t('wizard.draftUnavailable') : undefined}>
                <Icon name="sparkle" size={14} />
                <span>{working === 'draft' ? t('wizard.drafting') : t('wizard.draft')}</span>
              </button>
            </>
          ) : null}
          {step === 'instructions' ? (
            <>
              {editing ? <span /> : <button type="button" onClick={() => setStep('identity')} disabled={working !== null}>{t('wizard.back')}</button>}
              <button type="button" className="primary" onClick={() => setStep('abilities')} disabled={!instructionsReady}>{t('wizard.next')}</button>
            </>
          ) : null}
          {step === 'abilities' ? (
            <>
              <button type="button" onClick={() => setStep('instructions')} disabled={working !== null}>{t('wizard.back')}</button>
              <button type="button" className="primary" onClick={save} disabled={!instructionsReady || working !== null}>
                {working === 'save' ? t('wizard.saving') : editing ? t('wizard.save') : t('wizard.create')}
              </button>
            </>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
