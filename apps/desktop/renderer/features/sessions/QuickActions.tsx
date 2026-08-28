import type { AgentQuickAction } from '../../../shared/api';

export function QuickActions({
  actions,
  onChoose,
}: {
  actions: AgentQuickAction[];
  onChoose: (action: AgentQuickAction) => void;
}): JSX.Element | null {
  if (actions.length === 0) return null;
  return (
    <div className="quick-actions" aria-label="Career Agent quick actions">
      {actions.map((action) => (
        <button type="button" key={action.id} onClick={() => onChoose(action)}>
          <strong>{action.title}</strong>
          <span>Use prompt</span>
        </button>
      ))}
    </div>
  );
}
