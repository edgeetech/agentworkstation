import type { ChatMode, RoutingDecision } from '../../../shared/api';
import { useI18n } from '../../i18n';

export function PrivacyPanel({
  cloudPermitted,
  mode,
  route,
}: {
  cloudPermitted: boolean;
  mode: ChatMode;
  route?: RoutingDecision;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <dl className="privacy-details">
      <div><dt>{t('inspector.intelligencePreference')}</dt><dd>{t('inspector.auto')}</dd></div>
      <div><dt>{t('inspector.resolvedIntelligence')}</dt><dd>{route ? route.location === 'simulated' ? t('inspector.simulated') : route.modelId : t('inspector.notResolved')}</dd></div>
      <div><dt>{t('inspector.executionMode')}</dt><dd>{mode === 'autopilot' ? t('sidebar.autopilot') : t('sidebar.standard')}</dd></div>
      <div><dt>{t('inspector.policy')}</dt><dd>{cloudPermitted ? t('sidebar.cloudPermitted') : t('sidebar.localOnly')}</dd></div>
      <div><dt>{t('inspector.lastEndpoint')}</dt><dd>{route ? `${route.providerLabel} · ${route.location}` : t('inspector.noRequest')}</dd></div>
      <div><dt>{t('inspector.telemetry')}</dt><dd>{t('inspector.notImplemented')}</dd></div>
      <div><dt>{t('inspector.networkLedger')}</dt><dd>{t('inspector.historyUnavailable')}</dd></div>
      <p>{cloudPermitted
        ? t('inspector.cloudContext')
        : t('inspector.localContext')}</p>
    </dl>
  );
}
