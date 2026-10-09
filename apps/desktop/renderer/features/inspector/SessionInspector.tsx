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
import { useI18n } from '../../i18n';

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
  agentName,
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
  agentName?: string;
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
  const { t } = useI18n();
  const [tab, setTab] = useState<InspectorTab>('evidence');
  const [requestedFile, setRequestedFile] = useState<SourceReference | null>(null);
  const sources = useMemo(() => uniqueSources(history, additionalSources), [additionalSources, history]);
  const route = [...history].reverse().find((exchange) => exchange.route)?.route;

  if (!session) {
    return (
      <aside className="session-inspector" aria-label={t('inspector.aria')}>
        <div className="inspector-empty standalone"><strong>{t('inspector.noSession')}</strong><p>{t('inspector.noSessionHelp')}</p></div>
      </aside>
    );
  }
  return (
    <aside className="session-inspector" aria-label={t('inspector.aria')}>
      <div className="inspector-heading">
        <span>{t('inspector.activeSession')}</span>
        <strong>{session.name}</strong>
        <small>{workspace?.id ?? t('inspector.unassigned')} · {agentName ?? session.agentId}</small>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label={t('inspector.context')}>
        {(['files', 'evidence', 'actions', 'privacy'] as const).map((item) => (
          <button
            type="button"
            role="tab"
            id={`inspector-tab-${item}`}
            aria-controls={`inspector-panel-${item}`}
            aria-selected={tab === item}
            className={tab === item ? 'active' : ''}
            key={item}
            onClick={() => {
              if (item === 'files') setRequestedFile(null);
              setTab(item);
            }}
          >
            {t(`inspector.${item}`)}
            {item === 'evidence' && sources.length ? <b>{sources.length}</b> : null}
            {item === 'actions' && actions.length ? <b>{actions.length}</b> : null}
          </button>
        ))}
      </div>
      <div
        className="inspector-content"
        id={`inspector-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`inspector-tab-${tab}`}
      >
        {tab === 'files' ? (
          <FilesPanel
            workspaceId={requestedFile?.workspaceId ?? workspace?.id ?? null}
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
