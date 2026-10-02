import { useEffect, useRef, useState } from 'react';
import type { AgentSummary } from '../../../shared/api';
import { useI18n } from '../../i18n';
import { Icon } from '../shell/icons';
import { SpecialistAvatar } from './SpecialistAvatar';

const NAME_LIMIT = 48;
const TAGLINE_LIMIT = 60;

/** Edits how a specialist appears: its name and the short title under it. */
export function AgentProfileDialog({
  agent,
  onSave,
  onClose,
  onEditInstructions,
}: {
  agent: AgentSummary;
  onSave: (profile: { displayName: string | null; tagline: string | null }) => Promise<void>;
  onClose: () => void;
  /** Custom specialists can also open the full wizard for their instructions. */
  onEditInstructions?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(agent.name);
  const [tagline, setTagline] = useState(agent.tagline ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInput.current?.select();
  }, []);

  const trimmedName = name.trim();
  const trimmedTagline = tagline.trim();
  const changed = trimmedName !== agent.name || trimmedTagline !== (agent.tagline ?? '');
  const canSave = trimmedName.length > 0 && changed && !saving;
  const previewName = trimmedName || agent.defaultName;
  const previewTagline = trimmedTagline || t('profile.noTitle');

  const save = (): void => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    onSave({ displayName: trimmedName, tagline: trimmedTagline || null })
      .then(onClose)
      .catch((value: unknown) => {
        setError(value instanceof Error ? value.message : String(value));
        setSaving(false);
      });
  };

  return (
    <div
      className="palette-backdrop agent-wizard-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onClose(); }}
    >
      <section className={`agent-wizard agent-profile agent-tone-${agent.id}`} role="dialog" aria-modal="true" aria-labelledby="agent-profile-title">
        <header className="agent-wizard-header">
          <div>
            <h2 id="agent-profile-title">{t('profile.title')}</h2>
            <small>{t('profile.subtitle')}</small>
          </div>
          <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose} disabled={saving}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <form className="agent-wizard-body" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <div className="agent-profile-preview" aria-label={t('profile.preview')}>
            <span className="agent-profile-preview-label">{t('profile.preview')}</span>
            <div className="agent-switch active" aria-hidden="true">
              <SpecialistAvatar agentId={agent.id} name={previewName} />
              <span className="agent-switch-copy">
                <strong>{previewName}</strong>
                <small className={trimmedTagline ? '' : 'placeholder'}>{previewTagline}</small>
              </span>
            </div>
          </div>
          <label>
            <span className="agent-profile-field-head">
              {t('profile.name')}
              <em>{trimmedName.length}/{NAME_LIMIT}</em>
            </span>
            <input
              ref={nameInput}
              value={name}
              maxLength={NAME_LIMIT}
              onChange={(event) => setName(event.target.value)}
              placeholder={agent.defaultName}
            />
          </label>
          {agent.name !== agent.defaultName ? (
            <button type="button" className="link-button agent-profile-reset" onClick={() => setName(agent.defaultName)}>
              {t('profile.resetName', { name: agent.defaultName })}
            </button>
          ) : null}
          <label>
            <span className="agent-profile-field-head">
              {t('profile.tagline')}
              <em>{trimmedTagline.length}/{TAGLINE_LIMIT}</em>
            </span>
            <input
              value={tagline}
              maxLength={TAGLINE_LIMIT}
              onChange={(event) => setTagline(event.target.value)}
              placeholder={t('profile.taglinePlaceholder')}
            />
            <small>{t('profile.taglineHelp')}</small>
          </label>
          {error ? <div className="agent-wizard-error" role="alert">{error}</div> : null}
          <footer className="agent-wizard-footer agent-profile-footer">
            {onEditInstructions ? (
              <button type="button" className="secondary" onClick={onEditInstructions} disabled={saving}>
                <Icon name="settings" size={14} />
                {t('profile.editInstructions')}
              </button>
            ) : <span />}
            <span className="agent-profile-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
              <button type="submit" className="primary" disabled={!canSave}>
                <Icon name="check" size={14} />
                {saving ? t('profile.saving') : t('profile.save')}
              </button>
            </span>
          </footer>
        </form>
      </section>
    </div>
  );
}
