import { useMemo, useState } from 'react';
import type { ChatSessionRecord, WorkspaceRecord } from '../../../shared/api';
import { groupSessionsByWorkspace } from './sessionPresentation';

export type AgentView = 'agents' | 'home' | 'chat' | 'audit' | 'changes' | 'sources' | 'status' | 'settings';

export type AgentNavigationItem = {
  id: AgentView;
  label: string;
  hint: string;
};

export function SessionsSidebar({
  view,
  navigation,
  workspaces,
  sessions,
  pendingActionCount,
  busy,
  intelligenceSummary,
  cloudPermitted,
  onOpenAgents,
  onNavigate,
  onNewSession,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
}: {
  view: AgentView;
  navigation: AgentNavigationItem[];
  workspaces: WorkspaceRecord[];
  sessions: ChatSessionRecord[];
  pendingActionCount: number;
  busy: boolean;
  intelligenceSummary: string;
  cloudPermitted: boolean;
  onOpenAgents: () => void;
  onNavigate: (view: AgentView) => void;
  onNewSession: () => void;
  onOpenSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
}): JSX.Element {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const groups = useMemo(() => groupSessionsByWorkspace(workspaces, sessions), [sessions, workspaces]);
  const submitRename = (session: ChatSessionRecord): void => {
    const value = renameValue.trim();
    if (!value) return;
    onRenameSession(session.id, value);
    setRenameId(null);
    setRenameValue('');
  };

  return (
    <aside className="primary-sidebar" aria-label="Agent workspace navigation">
      <div className="brand">
        <span>AW</span>
        <div><strong>Agent Workstation</strong><small>Agent-first desktop</small></div>
      </div>
      <button className={`agent-picker ${view === 'agents' ? 'active' : ''}`} type="button" onClick={onOpenAgents}>
        <span className="agent-avatar">CA</span>
        <span><small>Active agent</small><strong>Career Agent</strong></span>
        <b>⌄</b>
      </button>
      <span className="sidebar-label">Agent workspace</span>
      <nav className="agent-navigation" aria-label="Career Agent areas">
        {navigation.map((item) => (
          <button className={view === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => onNavigate(item.id)}>
            <strong>{item.label}</strong><small>{item.hint}</small>
            {item.id === 'changes' && pendingActionCount > 0 ? <b>{pendingActionCount}</b> : null}
          </button>
        ))}
      </nav>
      <section className="sidebar-chats" aria-label="Career Agent conversations">
        <div className="sidebar-chats-heading">
          <span>Workspaces / sessions</span>
          <button type="button" aria-label="New chat" onClick={onNewSession} disabled={busy}>＋</button>
        </div>
        <div className="workspace-session-groups">
          {groups.length === 0 ? <small className="sidebar-empty">Add a workspace to start a session.</small> : groups.map((group) => (
            <section className="workspace-session-group" key={group.id}>
              <button
                type="button"
                className="workspace-group-heading"
                onClick={() => group.workspace && onNavigate('sources')}
                aria-label={`Workspace ${group.label}`}
              >
                <span aria-hidden="true">⌑</span>
                <strong>{group.label}</strong>
                <small>{group.sessions.length}</small>
              </button>
              {group.sessions.length === 0 ? <span className="workspace-no-session">No sessions</span> : (
                <ul className="session-list" aria-label={`${group.label} sessions`}>
                  {group.sessions.map((session) => (
                    <li className={session.selected ? 'active' : ''} key={session.id}>
                      {deleteId === session.id ? (
                        <div className="session-delete-confirm" role="group" aria-live="assertive" aria-label={`Delete ${session.name}?`}>
                          <span>Delete this chat?</span>
                          <div>
                            <button type="button" autoFocus onClick={() => setDeleteId(null)}>Cancel</button>
                            <button type="button" className="danger" onClick={() => { onDeleteSession(session.id); setDeleteId(null); }} disabled={busy}>Delete</button>
                          </div>
                        </div>
                      ) : renameId === session.id ? (
                        <form onSubmit={(event) => { event.preventDefault(); submitRename(session); }}>
                          <input
                            aria-label={`Rename ${session.name}`}
                            autoFocus
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') { setRenameId(null); setRenameValue(''); }
                            }}
                          />
                          <button type="submit" aria-label={`Save ${session.name} name`}>✓</button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="session-open"
                            aria-current={session.selected ? 'true' : undefined}
                            onClick={() => onOpenSession(session.id)}
                          >
                            <span className="session-status-dot" aria-hidden="true" />
                            <span><strong>{session.name}</strong><small>Auto · {session.mode === 'autopilot' ? 'Autopilot' : 'Standard'}</small></span>
                          </button>
                          <button
                            type="button"
                            className="session-actions-trigger"
                            aria-label={`Chat options for ${session.name}`}
                            aria-haspopup="menu"
                            aria-expanded={menuId === session.id}
                            onClick={() => setMenuId((current) => current === session.id ? null : session.id)}
                          >···</button>
                          {menuId === session.id ? (
                            <div className="session-actions-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => {
                                setMenuId(null); setRenameId(session.id); setRenameValue(session.name);
                              }}>Rename</button>
                              <button type="button" role="menuitem" className="danger" onClick={() => {
                                setMenuId(null); setDeleteId(session.id);
                              }}>Delete</button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </section>
      <div className="sidebar-footer">
        <button className="settings-link" type="button" onClick={() => onNavigate('settings')}>
          <span>Intelligence access</span><small>{intelligenceSummary}</small>
        </button>
        <div className="privacy policy-summary">
          <strong>{cloudPermitted ? '● Cloud permitted' : '● Local Only'}</strong>
          <small>{cloudPermitted
            ? 'Allowed cloud intelligence may be selected automatically.'
            : 'Cloud intelligence is disabled by policy.'}</small>
        </div>
      </div>
    </aside>
  );
}
