import type { ProviderConnection } from '../../../shared/api';
import { Icon } from '../shell/icons';
import { useI18n } from '../../i18n';

const providerMarks: Record<string, string> = { claude: 'Cl', codex: 'Cx', copilot: 'Gh', devin: 'Dv' };

/**
 * First-run shortcut: offers the AI connections already present on this machine
 * (the user's own subscriptions or on-device models) as one-click choices, so a new
 * user never has to understand routing policies before their first message.
 */
export function ConnectPanel({
  providers,
  localModelCount,
  busy,
  onUseProvider,
  onUseLocal,
  onRefresh,
  onMore,
}: {
  providers: ProviderConnection[];
  localModelCount: number;
  busy: boolean;
  onUseProvider: (provider: ProviderConnection) => void;
  onUseLocal: () => void;
  onRefresh: () => void;
  onMore: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const preference = ['claude', 'codex', 'copilot'];
  const rank = (id: string): number => preference.indexOf(id) >>> 0;
  const ready = providers
    .filter((provider) => provider.installed && provider.authenticated !== false && provider.availability !== 'unavailable')
    .sort((left, right) => rank(left.id) - rank(right.id));
  const nothing = ready.length === 0 && localModelCount === 0;
  return (
    <section className="connect-panel" aria-label={t('connect.title')}>
      <div className="connect-copy">
        <strong>{t('connect.title')}</strong>
        <span>{nothing ? t('connect.none') : `${t('connect.body')} ${t('connect.cloudNote')}.`}</span>
      </div>
      <div className="connect-options">
        {ready.slice(0, 3).map((provider) => (
          <button type="button" key={provider.id} className="connect-option" disabled={busy} onClick={() => onUseProvider(provider)}>
            <span className={`provider-mark provider-${provider.id}`} aria-hidden="true">{providerMarks[provider.id] ?? provider.label.charAt(0)}</span>
            <strong>{t('connect.use', { name: provider.label })}</strong>
          </button>
        ))}
        {localModelCount > 0 ? (
          <button type="button" className="connect-option" disabled={busy} onClick={onUseLocal}>
            <span className="provider-mark provider-local" aria-hidden="true"><Icon name="shield" size={14} /></span>
            <strong title={t('connect.localModels', { count: localModelCount })}>{t('connect.local')}</strong>
          </button>
        ) : null}
        <div className="connect-links">
          <button type="button" className="text" onClick={onRefresh} disabled={busy}>{t('connect.refresh')}</button>
          <button type="button" className="text" onClick={onMore}>{t('connect.more')}</button>
        </div>
      </div>
    </section>
  );
}
