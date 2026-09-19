import { useMemo, useState } from 'react';
import type { AgentSummary, ChatSessionRecord, WorkspaceRecord } from '../../../shared/api';
import { SpecialistAvatar } from '../agents/SpecialistAvatar';
import { useI18n } from '../../i18n';
import { latestSessionForAgent } from './sessionPresentation';

export type AgentView = 'agents' | 'home' | 'chat' | 'audit' | 'changes' | 'publication' | 'sources' | 'status' | 'settings';

export type AgentNavigationItem = {
  id: AgentView;
  label: string;
  hint: string;
};

export function SessionsSidebar({
  view,
  navigation,
  agents,
  activeAgent,
  workspaces,
  sessions,
  pendingActionCount,
  busy,
  intelligenceSummary,
  cloudPermitted,
  onOpenAgent,
  onRenameAgent,
  onNavigate,
  onNewSession,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
}: {
  view: AgentView;
  navigation: AgentNavigationItem[];
  agents: AgentSummary[];
  activeAgent?: AgentSummary;
  workspaces: WorkspaceRecord[];
  sessions: ChatSessionRecord[];
  pendingActionCount: number;
  busy: boolean;
  intelligenceSummary: string;
  cloudPermitted: boolean;
  onOpenAgent: (agentId: string) => void;
  onRenameAgent: (agentId: string, name: string) => void;
  onNavigate: (view: AgentView) => void;
  onNewSession: () => void;
  onOpenSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
}): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [agentRenameId, setAgentRenameId] = useState<string | null>(null);
  const [agentRenameValue, setAgentRenameValue] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const orderedAgents = useMemo(() => [...agents].sort((left, right) => {
    const priority = (id: string): number => id === 'career' ? 0 : id === 'blogger' ? 1 : 2;
    return priority(left.id) - priority(right.id) || left.name.localeCompare(right.name);
  }), [agents]);
  const activeSessions = useMemo(() => sessions
    .filter((session) => session.agentId === activeAgent?.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [activeAgent?.id, sessions]);
  const workspaceNames = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace.id])), [workspaces]);
  const submitRename = (session: ChatSessionRecord): void => {
    const value = renameValue.trim();
    if (!value) return;
    onRenameSession(session.id, value);
    setRenameId(null);
    setRenameValue('');
  };
  const submitAgentRename = (agent: AgentSummary): void => {
    const value = agentRenameValue.trim();
    if (!value) return;
    onRenameAgent(agent.id, value);
    setAgentRenameId(null);
    setAgentRenameValue('');
  };

  return (
    <aside className="primary-sidebar" aria-label={t('sidebar.aria')}>
      <div className="brand">
        <span>AW</span>
        <div><strong>Agent Workstation</strong><small>{t('sidebar.tagline')}</small></div>
      </div>
      <section className="agent-roster" aria-labelledby="agent-roster-title">
        <div className="agent-roster-heading">
          <span id="agent-roster-title">{t('sidebar.specialists')}</span>
          <small>{t('sidebar.available', { count: orderedAgents.length })}</small>
        </div>
        <ul>
          {orderedAgents.map((agent) => {
            const latest = latestSessionForAgent(sessions, agent.id);
            const active = agent.id === activeAgent?.id;
            const readiness = intelligenceSummary === 'Setup required'
              ? t('sidebar.setup')
              : intelligenceSummary.startsWith('Simulated') ? t('sidebar.demo') : t('sidebar.ready');
            return (
              <li className={`agent-roster-item agent-tone-${agent.id}`} key={agent.id}>
                {agentRenameId === agent.id ? (
                  <form
                    className="agent-rename-form"
                    onSubmit={(event) => { event.preventDefault(); submitAgentRename(agent); }}
                  >
                    <SpecialistAvatar agentId={agent.id} name={agent.name} />
                    <input
                      aria-label={t('sidebar.rename', { name: agent.name })}
                      autoFocus
                      maxLength={48}
                      value={agentRenameValue}
                      onChange={(event) => setAgentRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') { setAgentRenameId(null); setAgentRenameValue(''); }
                      }}
                    />
                    <button type="submit" aria-label={t('sidebar.saveName', { name: agent.name })} disabled={!agentRenameValue.trim()}>✓</button>
                    <button type="button" aria-label={t('sidebar.cancelRename', { name: agent.name })} onClick={() => {
                      setAgentRenameId(null); setAgentRenameValue('');
                    }}>×</button>
                  </form>
                ) : (
                  <>
                    <button
                      className={`agent-switch ${active ? 'active' : ''}`}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      aria-label={t('sidebar.open', { name: agent.name })}
                      title={agent.description}
                      onClick={() => onOpenAgent(agent.id)}
                    >
                      <SpecialistAvatar agentId={agent.id} name={agent.name} />
                      <span className="agent-switch-copy">
                        <span className="agent-switch-title"><strong>{agent.name}</strong><i>{readiness}</i></span>
                        <small>{latest?.name ?? t('sidebar.firstConversation')}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="agent-rename-trigger"
                      aria-label={t('sidebar.rename', { name: agent.name })}
                      title={t('sidebar.rename', { name: agent.name })}
                      onClick={() => { setAgentRenameId(agent.id); setAgentRenameValue(agent.name); }}
                    >•••</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <span className="sidebar-label">{t('sidebar.workspace', { name: activeAgent?.name ?? 'Specialist' })}</span>
      <nav className="agent-navigation" aria-label={t('sidebar.areas', { name: activeAgent?.name ?? 'Specialist' })}>
        {navigation.map((item) => (
          <button className={view === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => onNavigate(item.id)}>
            <strong>{item.label}</strong><small>{item.hint}</small>
            {item.id === 'changes' && pendingActionCount > 0 ? <b>{pendingActionCount}</b> : null}
          </button>
        ))}
      </nav>
      <section className="sidebar-chats" aria-label={t('sidebar.conversationHistory', { name: activeAgent?.name ?? 'Specialist' })}>
        <div className="sidebar-chats-heading">
          <span>{t('sidebar.conversations')}</span>
          <button type="button" aria-label={t('sidebar.newConversation', { name: activeAgent?.name ?? 'specialist' })} onClick={onNewSession} disabled={busy}>＋</button>
        </div>
        <div className="agent-session-history">
          {activeSessions.length === 0 ? <small className="sidebar-empty">{t('sidebar.noConversations')}</small> : (
                <ul className="session-list" aria-label={t('sidebar.conversationList', { name: activeAgent?.name ?? 'Specialist' })}>
                  {activeSessions.map((session) => (
                    <li className={session.selected ? 'active' : ''} key={session.id}>
                      {deleteId === session.id ? (
                        <div className="session-delete-confirm" role="group" aria-live="assertive" aria-label={t('sidebar.deleteQuestion', { name: session.name })}>
                          <span>{t('sidebar.deleteChat')}</span>
                          <div>
                            <button type="button" autoFocus onClick={() => setDeleteId(null)}>{t('common.cancel')}</button>
                            <button type="button" className="danger" onClick={() => { onDeleteSession(session.id); setDeleteId(null); }} disabled={busy}>{t('common.delete')}</button>
                          </div>
                        </div>
                      ) : renameId === session.id ? (
                        <form onSubmit={(event) => { event.preventDefault(); submitRename(session); }}>
                          <input
                            aria-label={t('sidebar.rename', { name: session.name })}
                            autoFocus
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') { setRenameId(null); setRenameValue(''); }
                            }}
                          />
                          <button type="submit" aria-label={t('sidebar.saveName', { name: session.name })}>✓</button>
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
                            <span><strong>{session.name}</strong><small>{session.workspaceId ? workspaceNames.get(session.workspaceId) ?? session.workspaceId : t('sidebar.noWorkspace')} · {session.mode === 'autopilot' ? t('sidebar.autopilot') : t('sidebar.standard')}</small></span>
                          </button>
                          <button
                            type="button"
                            className="session-actions-trigger"
                            aria-label={t('sidebar.chatOptions', { name: session.name })}
                            aria-haspopup="menu"
                            aria-expanded={menuId === session.id}
                            onClick={() => setMenuId((current) => current === session.id ? null : session.id)}
                          >···</button>
                          {menuId === session.id ? (
                            <div className="session-actions-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => {
                                setMenuId(null); setRenameId(session.id); setRenameValue(session.name);
                              }}>{t('common.rename')}</button>
                              <button type="button" role="menuitem" className="danger" onClick={() => {
                                setMenuId(null); setDeleteId(session.id);
                              }}>{t('common.delete')}</button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
          )}
        </div>
      </section>
      <div className="sidebar-footer">
        <button className="settings-link" type="button" onClick={() => onNavigate('settings')}>
          <span>{t('sidebar.intelligence')}</span><small>{intelligenceSummary}</small>
        </button>
        <div className="privacy policy-summary">
          <strong>● {cloudPermitted ? t('sidebar.cloudPermitted') : t('sidebar.localOnly')}</strong>
        </div>
        <label className="language-picker">
          <span>{t('language.label')}</span>
          <select value={locale} onChange={(event) => setLocale(event.target.value as 'en' | 'tr')}>
            <option value="en">{t('language.english')}</option>
            <option value="tr">{t('language.turkish')}</option>
          </select>
        </label>
      </div>
    </aside>
  );
}
