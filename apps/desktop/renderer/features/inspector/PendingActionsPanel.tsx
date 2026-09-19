import type { PendingAction } from '../../../shared/api';
import { useI18n } from '../../i18n';

export function PendingActionsPanel({
  actions,
  busy,
  onApprove,
  onReject,
  onOpenReview,
}: {
  actions: PendingAction[];
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onOpenReview: () => void;
}): JSX.Element {
  const { t } = useI18n();
  if (actions.length === 0) {
    return <div className="inspector-empty"><strong>{t('inspector.noActions')}</strong><p>{t('inspector.noActionsHelp')}</p></div>;
  }
  return (
    <div className="inspector-actions-list">
      {actions.map((action) => (
        <article key={action.id}>
          <span>{action.status}</span>
          <strong>{action.targetPath}</strong>
          <small>{action.workspaceId}</small>
          <pre>{action.diff}</pre>
          <div>
            <button type="button" onClick={onOpenReview}>{t('common.details')}</button>
            <button type="button" onClick={() => onReject(action.id)} disabled={busy}>{t('common.reject')}</button>
            <button className="primary" type="button" onClick={() => onApprove(action.id)} disabled={busy}>{t('common.approve')}</button>
          </div>
        </article>
      ))}
    </div>
  );
}
