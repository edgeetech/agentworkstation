import { useMemo, useState } from 'react';
import type {
  ChatExchange,
  ChatSessionRecord,
  PendingAction,
  SourceReference,
  WorkspaceEntry,
  WorkspaceFilePreview,
  WorkspaceRecord,
} from '../../../shared/api';
import { EvidencePanel } from './EvidencePanel';
import { FilesPanel } from './FilesPanel';
import { PendingActionsPanel } from './PendingActionsPanel';
import { PrivacyPanel } from './PrivacyPanel';

type InspectorTab = 'files' | 'evidence' | 'actions' | 'privacy';

function uniqueSources(history: ChatExchange[], additional: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  return [...history.flatMap((exchange) => exchange.sourceReferences), ...additional].filter((source) => {
    const key = JSON.stringify(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SessionInspector({
  session,
  workspace,
  history,
  additionalSources,
  actions,
  cloudPermitted,
  busy,
  listEntries,
  readFile,
  onApprove,
  onReject,
  onOpenReview,
  onError,
}: {
  session?: ChatSessionRecord;
  workspace?: WorkspaceRecord;
  history: ChatExchange[];
  additionalSources: SourceReference[];
  actions: PendingAction[];
  cloudPermitted: boolean;
  busy: boolean;
  listEntries: (workspaceId: string, relativePath: string) => Promise<WorkspaceEntry[]>;
  readFile: (workspaceId: string, relativePath: string) => Promise<WorkspaceFilePreview>;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onOpenReview: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState<InspectorTab>('evidence');
  const [requestedFile, setRequestedFile] = useState<SourceReference | null>(null);
  const sources = useMemo(() => uniqueSources(history, additionalSources), [additionalSources, history]);
  const route = [...history].reverse().find((exchange) => exchange.route)?.route;

  if (!session) {
    return (
      <aside className="session-inspector" aria-label="Active session inspector">
        <div className="inspector-empty standalone"><strong>No active session</strong><p>Create a session to inspect files, evidence, actions, and privacy.</p></div>
      </aside>
    );
  }
  return (
    <aside className="session-inspector" aria-label="Active session inspector">
      <div className="inspector-heading">
        <span>Active session</span>
        <strong>{session.name}</strong>
        <small>{workspace?.id ?? 'Unassigned workspace'} · Career Agent</small>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Session context">
        {(['files', 'evidence', 'actions', 'privacy'] as const).map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'active' : ''}
            key={item}
            onClick={() => {
              if (item === 'files') setRequestedFile(null);
              setTab(item);
            }}
          >
            {item[0].toUpperCase() + item.slice(1)}
            {item === 'evidence' && sources.length ? <b>{sources.length}</b> : null}
            {item === 'actions' && actions.length ? <b>{actions.length}</b> : null}
          </button>
        ))}
      </div>
      <div className="inspector-content">
        {tab === 'files' ? (
          <FilesPanel
            workspaceId={requestedFile?.workspaceId ?? session.workspaceId}
            listEntries={listEntries}
            readFile={readFile}
            requestedFile={requestedFile?.relativePath}
            onError={onError}
          />
        ) : tab === 'evidence' ? (
          <EvidencePanel sources={sources} onOpenFile={(source) => {
            setRequestedFile(source);
            setTab('files');
          }} />
        ) : tab === 'actions' ? (
          <PendingActionsPanel actions={actions} busy={busy} onApprove={onApprove} onReject={onReject} onOpenReview={onOpenReview} />
        ) : (
          <PrivacyPanel cloudPermitted={cloudPermitted} mode={session.mode} route={route} />
        )}
      </div>
    </aside>
  );
}
