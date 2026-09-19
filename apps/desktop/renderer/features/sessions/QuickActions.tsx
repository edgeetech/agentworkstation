import type { AgentQuickAction } from '../../../shared/api';
import { useI18n } from '../../i18n';

export function QuickActions({
  actions,
  onChoose,
}: {
  actions: AgentQuickAction[];
  onChoose: (action: AgentQuickAction) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (actions.length === 0) return null;
  return (
    <div className="quick-actions" aria-label={t('session.quickActions')}>
      {actions.map((action) => (
        <button type="button" key={action.id} onClick={() => onChoose(action)}>
          <strong>{action.title}</strong>
          <span>{t('session.usePrompt')}</span>
        </button>
      ))}
    </div>
  );
}
