import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

type SourceReference = {
  type: string;
  workspaceId?: string;
  relativePath?: string;
  commitSha?: string;
  label?: string;
};

type DemoAudit = {
  title: string;
  summary: string;
  result: {
    content: string;
    workspaceIds: string[];
    sourceReferences: SourceReference[];
  };
};

type PendingAction = {
  id: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'STALE';
  targetPath: string;
  diff: string;
  rejectionReason?: string;
};

function App(): JSX.Element {
  const [audit, setAudit] = useState<DemoAudit | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadPendingActions = (): void => {
    const api = window.agentWorkstation;
    if (!api) return;
    void api.listPendingActions().then(setPendingActions).catch((value: unknown) => {
      setError(value instanceof Error ? value.message : String(value));
    });
  };

  useEffect(() => {
    const api = window.agentWorkstation;
    if (!api) {
      setAudit({
        title: 'Agent Workstation',
        summary: 'Local agent bridge unavailable.',
        result: { content: 'No local agent data was exposed over the preload bridge.', workspaceIds: [], sourceReferences: [] },
      });
      return;
    }

    void api.getDemoAudit().then((demo) => setAudit(demo));
    loadPendingActions();
  }, []);

  if (!audit) {
    return <div style={{ padding: 24, fontFamily: 'sans-serif' }}>Loading Career Audit…</div>;
  }

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif', lineHeight: 1.5 }}>
      <h1 style={{ marginTop: 0 }}>Agent Workstation</h1>
      <h2>{audit.title}</h2>
      <p>{audit.summary}</p>
      <ul>
        {audit.result.workspaceIds.map((workspaceId) => (
          <li key={workspaceId}>{workspaceId}</li>
        ))}
      </ul>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
        {audit.result.content}
      </pre>
      <h3>Source references</h3>
      <ul>
        {audit.result.sourceReferences.map((reference, index) => (
          <li key={`${reference.type}-${reference.label ?? reference.relativePath ?? reference.commitSha ?? index}`}>
            {reference.type}:{reference.label ?? reference.relativePath ?? reference.commitSha ?? reference.workspaceId ?? 'unknown'}
          </li>
        ))}
      </ul>

      <h3>Pending actions</h3>
      {error ? <p style={{ color: '#b00020' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => {
            const api = window.agentWorkstation;
            if (!api) return;
            void api.proposeReadmeUpdate()
              .then(() => loadPendingActions())
              .catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
          }}
        >
          Propose README update
        </button>
        <button type="button" onClick={loadPendingActions}>Refresh pending actions</button>
      </div>
      {pendingActions.length === 0 ? <p>No pending actions.</p> : null}
      {pendingActions.map((action) => (
        <section key={action.id} style={{ border: '1px solid #ddd', padding: 12, marginBottom: 12, borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px 0' }}>
            <strong>{action.status}</strong> — {action.targetPath}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f8f8f8', padding: 12, borderRadius: 8 }}>{action.diff}</pre>
          {action.rejectionReason ? <p>Reason: {action.rejectionReason}</p> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                const api = window.agentWorkstation;
                if (!api) return;
                void api.approvePendingAction(action.id)
                  .then(() => loadPendingActions())
                  .catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
              }}
            >
              Approve and execute
            </button>
            <button
              type="button"
              onClick={() => {
                const api = window.agentWorkstation;
                if (!api) return;
                void api.rejectPendingAction(action.id, 'Rejected from desktop review UI')
                  .then(() => loadPendingActions())
                  .catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
              }}
            >
              Reject
            </button>
          </div>
        </section>
      ))}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
