import { useEffect, useMemo, useState } from 'react';
import type {
  AgentSummary,
  CreateChatSessionInput,
  WorkspaceRecord,
} from '../../../shared/api';
import { QuickActions } from './QuickActions';

export function NewSessionComposer({
  agents,
  workspaces,
  defaultWorkspaceId,
  cloudPermitted,
  busy,
  onCancel,
  onCreate,
}: {
  agents: AgentSummary[];
  workspaces: WorkspaceRecord[];
  defaultWorkspaceId?: string;
  cloudPermitted: boolean;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: CreateChatSessionInput, prompt: string) => void;
}): JSX.Element {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? workspaces[0]?.id ?? '');
  const [agentId, setAgentId] = useState<'career'>('career');
  const [prompt, setPrompt] = useState('');
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? agents[0],
    [agentId, agents],
  );

  useEffect(() => {
    if (!workspaceId && workspaces[0]) setWorkspaceId(workspaces[0].id);
  }, [workspaceId, workspaces]);

  const submit = (): void => {
    const trimmed = prompt.trim();
    if (!workspaceId || !trimmed) return;
    onCreate({
      name: trimmed.length > 52 ? `${trimmed.slice(0, 49)}…` : trimmed,
      workspaceId,
      agentId,
      intelligencePreference: 'auto',
      permissionMode: 'interactive',
      isolationMode: 'read_only',
    }, trimmed);
  };

  return (
    <section className="new-session-composer" aria-labelledby="new-session-title">
      <div className="new-session-heading">
        <div>
          <span>New persistent session</span>
          <h1 id="new-session-title">Start with the right context</h1>
        </div>
        <button type="button" className="icon-button" aria-label="Close new session composer" onClick={onCancel}>×</button>
      </div>
      <div className="session-configuration-grid">
        <label>
          <span>Workspace</span>
          <select aria-label="Session workspace" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.id}</option>)}
          </select>
        </label>
        <label>
          <span>Agent</span>
          <select aria-label="Session agent" value={agentId} onChange={(event) => setAgentId(event.target.value as 'career')}>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <div className="session-setting">
          <span>Intelligence preference</span>
          <strong>Auto</strong>
          <small>Career Agent resolves the model per prompt.</small>
        </div>
        <div className="session-setting">
          <span>Execution policy</span>
          <strong>{cloudPermitted ? 'Cloud permitted' : 'Local Only'}</strong>
          <small>Inherited from Intelligence access.</small>
        </div>
        <div className="session-setting">
          <span>Permissions</span>
          <strong>Interactive</strong>
          <small>Side effects always require review.</small>
        </div>
        <div className="session-setting">
          <span>Isolation</span>
          <strong>Read only</strong>
          <small>Writes become PendingActions.</small>
        </div>
      </div>
      {workspaces.length === 0 ? <p className="composer-empty" role="status">Add a workspace before creating a persistent session.</p> : null}
      <QuickActions actions={selectedAgent?.quickActions ?? []} onChoose={(action) => setPrompt(action.prompt)} />
      <label className="new-session-prompt">
        <span>First prompt</span>
        <textarea
          autoFocus
          aria-label="First session prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="What should Career Agent work on?"
        />
      </label>
      <div className="new-session-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" type="button" disabled={!workspaceId || !selectedAgent || !prompt.trim() || busy} onClick={submit}>
          Create session
        </button>
      </div>
    </section>
  );
}
