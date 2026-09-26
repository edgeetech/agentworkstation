import { useEffect, useMemo, useState } from 'react';
import type { AgentSummary, ChatSessionRecord, WorkspaceRecord } from '../../../shared/api';
import { SpecialistAvatar } from '../agents/SpecialistAvatar';
import { useI18n, type MessageKey } from '../../i18n';
import { groupSessionsByRecency, latestSessionForAgent, type RecencyBucket } from './sessionPresentation';
import { Icon, type IconName } from '../shell/icons';
import type { ThemePreference } from '../shell/theme';

export type AgentView = 'agents' | 'home' | 'chat' | 'audit' | 'changes' | 'publication' | 'sources' | 'status' | 'settings';

export type AgentNavigationItem = {
  id: AgentView;
  label: string;
  hint: string;
};

const navIcons: Partial<Record<AgentView, IconName>> = {
  chat: 'chat',
  audit: 'audit',
  changes: 'review',
  sources: 'folder',
  publication: 'globe',
};

const bucketKeys: Record<RecencyBucket, MessageKey> = {
  today: 'shell.today',
  yesterday: 'shell.yesterday',
  week: 'shell.lastWeek',
  older: 'shell.older',
};

const themeIcons: Record<ThemePreference, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };
const themeKeys: Record<ThemePreference, MessageKey> = {
  system: 'shell.themeSystem',
  light: 'shell.themeLight',
  dark: 'shell.themeDark',
};

export const shortcutLabel = (key: string): string =>
  navigator.platform.toLowerCase().includes('mac') ? `⌘${key}` : `Ctrl ${key}`;

export function SessionsSidebar({
  view,
  navigation,
  agents,
  activeAgent,
  workspaces,
  sessions,
  pendingActionCount,
  busy,
  intelligenceReady,
  intelligenceSummary,
  cloudPermitted,
  theme,
  onCycleTheme,
  onOpenAgent,
  onRenameAgent,
  onNavigate,
  onNewSession,
  onSearch,
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
  intelligenceReady: boolean;
  intelligenceSummary: string;
  cloudPermitted: boolean;
  theme: ThemePreference;
  onCycleTheme: () => void;
  onOpenAgent: (agentId: string) => void;
  onRenameAgent: (agentId: string, name: string) => void;
  onNavigate: (view: AgentView) => void;
  onNewSession: () => void;
  onSearch: () => void;
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
  const activeName = activeAgent?.name ?? 'Specialist';
  const orderedAgents = useMemo(() => [...agents].sort((left, right) => {
    const priority = (id: string): number => ['career', 'blogger', 'accountant'].indexOf(id) >>> 0;
    return priority(left.id) - priority(right.id) || left.name.localeCompare(right.name);
  }), [agents]);
  const recencyGroups = useMemo(
    () => groupSessionsByRecency(sessions.filter((session) => session.agentId === activeAgent?.id)),
    [activeAgent?.id, sessions],
  );
  const workspaceNames = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace.id])), [workspaces]);

  useEffect(() => {
    if (!menuId) return undefined;
    const close = (event: PointerEvent): void => {
      if (!(event.target as HTMLElement).closest('.session-actions-menu, .session-actions-trigger')) setMenuId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuId]);

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
      <div className="sidebar-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <path fill="#e04a7e" d="M4 10H28.8L13.8 54z" />
              <path fill="#0293de" d="M17 54 32 10 47 54z" />
              <path fill="currentColor" d="M60 10H35.2L50.2 54z" />
            </svg>
          </span>
          <strong>Agent Workstation</strong>
        </div>
      </div>
      <div className="sidebar-actions">
        <button
          type="button"
          className="sidebar-action new-chat"
          aria-label={t('shell.newChatWith', { name: activeName })}
          onClick={onNewSession}
          disabled={busy}
        >
          <Icon name="pencil" size={16} />
          <span>{t('shell.newChat')}</span>
          <kbd>{shortcutLabel('N')}</kbd>
        </button>
        <button type="button" className="sidebar-action" onClick={onSearch}>
          <Icon name="search" size={16} />
          <span>{t('shell.search')}</span>
          <kbd>{shortcutLabel('K')}</kbd>
        </button>
      </div>
      <div className="sidebar-scroll">
        <section className="agent-roster" aria-labelledby="agent-roster-title">
          <h2 className="sidebar-heading" id="agent-roster-title">{t('shell.specialists')}</h2>
          <ul>
            {orderedAgents.map((agent, index) => {
              const latest = latestSessionForAgent(sessions, agent.id);
              const active = agent.id === activeAgent?.id;
              return (
                <li className={`agent-roster-item agent-tone-${agent.id}`} key={agent.id}>
                  {agentRenameId === agent.id ? (
                    <form className="agent-rename-form" onSubmit={(event) => { event.preventDefault(); submitAgentRename(agent); }}>
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
                      <button type="submit" aria-label={t('sidebar.saveName', { name: agent.name })} disabled={!agentRenameValue.trim()}><Icon name="check" size={14} /></button>
                      <button type="button" aria-label={t('sidebar.cancelRename', { name: agent.name })} onClick={() => { setAgentRenameId(null); setAgentRenameValue(''); }}><Icon name="x" size={14} /></button>
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
                          <strong>{agent.name}</strong>
                          <small>{latest?.name ?? t('sidebar.firstConversation')}</small>
                        </span>
                        {index < 9 ? <kbd className="agent-shortcut">{shortcutLabel(String(index + 1))}</kbd> : null}
                      </button>
                      <button
                        type="button"
                        className="agent-rename-trigger"
                        aria-label={t('sidebar.rename', { name: agent.name })}
                        title={t('sidebar.rename', { name: agent.name })}
                        onClick={() => { setAgentRenameId(agent.id); setAgentRenameValue(agent.name); }}
                      ><Icon name="pencil" size={14} /></button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <nav className="agent-navigation" aria-label={t('sidebar.areas', { name: activeName })}>
          {navigation.map((item) => (
            <button
              className={view === item.id ? 'active' : ''}
              aria-current={view === item.id ? 'page' : undefined}
              type="button"
              key={item.id}
              title={item.hint}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={navIcons[item.id] ?? 'bolt'} size={16} />
              <span>{item.label}</span>
              {item.id === 'changes' && pendingActionCount > 0 ? <b>{pendingActionCount}</b> : null}
            </button>
          ))}
        </nav>
        <section className="sidebar-chats" aria-label={t('sidebar.conversationHistory', { name: activeName })}>
          <div className="sidebar-heading-row">
            <h2 className="sidebar-heading">{t('sidebar.conversations')}</h2>
            <button
              type="button"
              className="icon-button sidebar-heading-action"
              aria-label={t('sidebar.newConversation', { name: activeName })}
              title={t('sidebar.newConversation', { name: activeName })}
              onClick={onNewSession}
              disabled={busy}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>
          {recencyGroups.length === 0 ? <p className="sidebar-empty">{t('sidebar.noConversations')}</p> : (
            <ul className="session-list" aria-label={t('sidebar.conversationList', { name: activeName })}>
              {recencyGroups.map((group) => [
                <li className="session-bucket" key={`bucket-${group.bucket}`} aria-hidden="true">{t(bucketKeys[group.bucket])}</li>,
                ...group.sessions.map((session) => (
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
                        <button type="submit" aria-label={t('sidebar.saveName', { name: session.name })}><Icon name="check" size={14} /></button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="session-open"
                          aria-current={session.selected ? 'true' : undefined}
                          title={`${session.workspaceId ? workspaceNames.get(session.workspaceId) ?? session.workspaceId : t('sidebar.noWorkspace')}, ${session.mode === 'autopilot' ? t('sidebar.autopilot') : t('sidebar.standard')}`}
                          onClick={() => onOpenSession(session.id)}
                        >
                          <strong>{session.name}</strong>
                        </button>
                        <button
                          type="button"
                          className="session-actions-trigger"
                          aria-label={t('sidebar.chatOptions', { name: session.name })}
                          aria-haspopup="menu"
                          aria-expanded={menuId === session.id}
                          onClick={() => setMenuId((current) => current === session.id ? null : session.id)}
                        ><Icon name="more" size={16} /></button>
                        {menuId === session.id ? (
                          <div className="session-actions-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => {
                              setMenuId(null); setRenameId(session.id); setRenameValue(session.name);
                            }}><Icon name="pencil" size={14} />{t('common.rename')}</button>
                            <button type="button" role="menuitem" className="danger" onClick={() => {
                              setMenuId(null); setDeleteId(session.id);
                            }}><Icon name="x" size={14} />{t('common.delete')}</button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </li>
                )),
              ])}
            </ul>
          )}
        </section>
      </div>
      <div className="sidebar-footer">
        <button className="settings-link" type="button" onClick={() => onNavigate('settings')}>
          <span className={`status-light ${intelligenceReady ? 'on' : ''}`} aria-hidden="true" />
          <span className="settings-link-copy">
            <strong>{intelligenceSummary}</strong>
            <small>{t('sidebar.intelligence')}, {cloudPermitted ? t('sidebar.cloudPermitted') : t('sidebar.localOnly')}</small>
          </span>
        </button>
        <div className="sidebar-footer-tools">
          <button
            type="button"
            className="icon-button"
            onClick={onCycleTheme}
            aria-label={t('shell.cycleTheme', { theme: t(themeKeys[theme]) })}
            title={t('shell.cycleTheme', { theme: t(themeKeys[theme]) })}
          >
            <Icon name={themeIcons[theme]} size={16} />
          </button>
          <label className="language-picker">
            <span className="visually-hidden">{t('language.label')}</span>
            <select aria-label={t('language.label')} value={locale} onChange={(event) => setLocale(event.target.value as 'en' | 'tr')}>
              <option value="en" title={t('language.english')}>EN</option>
              <option value="tr" title={t('language.turkish')}>TR</option>
            </select>
          </label>
        </div>
      </div>
    </aside>
  );
}
