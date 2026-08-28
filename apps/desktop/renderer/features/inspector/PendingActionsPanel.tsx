import type { PendingAction } from '../../../shared/api';

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
  if (actions.length === 0) {
    return <div className="inspector-empty"><strong>No pending actions</strong><p>Model requests cannot write directly. Proposed changes will wait here for approval.</p></div>;
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
            <button type="button" onClick={onOpenReview}>Details</button>
            <button type="button" onClick={() => onReject(action.id)} disabled={busy}>Reject</button>
            <button className="primary" type="button" onClick={() => onApprove(action.id)} disabled={busy}>Approve</button>
          </div>
        </article>
      ))}
    </div>
  );
}
