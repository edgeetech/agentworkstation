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

function App(): JSX.Element {
  const [audit, setAudit] = useState<DemoAudit | null>(null);

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
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
