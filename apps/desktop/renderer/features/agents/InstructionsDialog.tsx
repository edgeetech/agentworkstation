import { useEffect, useState } from 'react';
import type { AgentSummary, AgentWorkstationApi, BuiltInInstructions } from '../../../shared/api';
import { useI18n } from '../../i18n';
import { Icon } from '../shell/icons';
import { SpecialistAvatar } from './SpecialistAvatar';

/** Edits a shipped specialist's instructions and rules; the packaged text stays one click away. */
export function InstructionsDialog({
  api,
  agent,
  onClose,
  onSaved,
}: {
  api: AgentWorkstationApi;
  agent: AgentSummary;
  onClose: () => void;
  onSaved: (message: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<BuiltInInstructions | null>(null);
  const [instructions, setInstructions] = useState('');
  const [rules, setRules] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: BuiltInInstructions): void => {
    setLoaded(next);
    setInstructions(next.instructions);
    setRules(next.rules);
  };

  useEffect(() => {
    void api.getBuiltInInstructions(agent.id).then(apply).catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
  }, [api, agent.id]);

  const changed = loaded !== null && (instructions !== loaded.instructions || rules !== loaded.rules);
  const differsFromOriginal = loaded !== null && (instructions !== loaded.original.instructions || rules !== loaded.original.rules);

  const run = (work: () => Promise<BuiltInInstructions>, message: string): void => {
    setWorking(true);
    setError(null);
    void work()
      .then((next) => {
        apply(next);
        onSaved(message);
        onClose();
      })
      .catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)))
      .finally(() => setWorking(false));
  };

  return (
    <div
      className="palette-backdrop agent-wizard-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape' && !working) onClose(); }}
    >
      <section className={`agent-wizard agent-instructions agent-tone-${agent.id}`} role="dialog" aria-modal="true" aria-labelledby="agent-instructions-title">
        <header className="agent-wizard-header">
          <SpecialistAvatar agentId={agent.id} name={agent.name} />
          <div>
            <h2 id="agent-instructions-title">{t('instructions.title', { name: agent.name })}</h2>
            <small>{loaded?.edited ? t('instructions.editedNote') : t('instructions.originalNote')}</small>
          </div>
          <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose} disabled={working}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="agent-wizard-body">
          <label>
            <span>{t('instructions.instructions')}</span>
            <textarea className="mono" rows={14} value={instructions} onChange={(event) => setInstructions(event.target.value)} disabled={!loaded} />
          </label>
          <label>
            <span>{t('instructions.rules')}</span>
            <textarea className="mono" rows={8} value={rules} onChange={(event) => setRules(event.target.value)} disabled={!loaded} />
            <small>{t('instructions.help')}</small>
          </label>
          {error ? <div className="agent-wizard-error" role="alert">{error}</div> : null}
        </div>
        <footer className="agent-wizard-footer">
          <button
            type="button"
            className="secondary"
            disabled={working || !loaded || (!loaded.edited && !differsFromOriginal)}
            onClick={() => run(() => api.resetBuiltInInstructions(agent.id), t('instructions.resetDone', { name: agent.name }))}
          >
            {t('instructions.reset')}
          </button>
          <span className="agent-profile-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={working}>{t('common.cancel')}</button>
            <button
              type="button"
              className="primary"
              disabled={working || !changed || !instructions.trim()}
              onClick={() => run(() => api.saveBuiltInInstructions(agent.id, instructions, rules), t('instructions.saved', { name: agent.name }))}
            >
              <Icon name="check" size={14} />{t('profile.save')}
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
}
