import { useCallback, useEffect, useState } from 'react';
import type { AgentSource, AgentSourceList, AgentWorkstationApi } from '../../../shared/api';
import { useI18n } from '../../i18n';
import { Icon, type IconName } from '../shell/icons';

const kindIcon: Record<AgentSource['kind'], IconName> = { folder: 'folder', file: 'file', web: 'globe', missing: 'x' };

/** One specialist's sources: folders, files, and web pages the owner gave to it alone. */
export function SourcesPage({
  api,
  agentId,
  agentName,
  onChanged,
  onError,
}: {
  api: AgentWorkstationApi;
  agentId: string;
  agentName: string;
  onChanged?: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [list, setList] = useState<AgentSourceList | null>(null);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const apply = useCallback((next: AgentSourceList): void => {
    setList(next);
    setNotes(Object.fromEntries([...next.assigned, ...next.unassigned].map((source) => [source.id, source.note])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.listAgentSources(agentId)
      .then((next) => { if (!cancelled) apply(next); })
      .catch((value: unknown) => onError(value instanceof Error ? value.message : String(value)));
    return () => { cancelled = true; };
  }, [api, agentId, apply, onError]);

  const run = (work: () => Promise<AgentSourceList | void>): void => {
    setWorking(true);
    void work()
      .then((next) => {
        if (next) apply(next);
        onChanged?.();
      })
      .catch((value: unknown) => onError(value instanceof Error ? value.message : String(value)))
      .finally(() => setWorking(false));
  };

  const add = (value = location): void => {
    if (!value.trim()) return;
    run(async () => {
      const next = await api.addAgentSource(agentId, value.trim(), note.trim() || undefined);
      setLocation('');
      setNote('');
      return next;
    });
  };

  const browse = (pick: () => Promise<string | null>): void => {
    void pick().then((picked) => { if (picked) setLocation(picked); });
  };

  const saveNote = (source: AgentSource): void => {
    const value = (notes[source.id] ?? '').trim();
    if (value === source.note) return;
    run(async () => {
      await api.setSourceNote(source.id, value);
      return api.listAgentSources(agentId);
    });
  };

  const row = (source: AgentSource, assigned: boolean): JSX.Element => (
    <li className={`source-row source-${source.kind}`} key={source.id}>
      <span className="source-icon" title={t(`sources.kind.${source.kind}`)}><Icon name={kindIcon[source.kind]} size={16} /></span>
      <span className="source-main">
        <strong title={source.location}>{source.location}</strong>
        {source.kind === 'missing' ? <small className="source-warning">{t('sources.missing')}</small> : null}
        <input
          aria-label={t('sources.noteFor', { location: source.location })}
          value={notes[source.id] ?? ''}
          maxLength={200}
          placeholder={t('sources.addNote')}
          onChange={(event) => setNotes((current) => ({ ...current, [source.id]: event.target.value }))}
          onBlur={() => saveNote(source)}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        />
      </span>
      {assigned ? (
        <button type="button" className="text" disabled={working} onClick={() => run(() => api.removeAgentSource(agentId, source.id))}>
          {t('sources.remove')}
        </button>
      ) : (
        <span className="source-actions">
          <button type="button" disabled={working} onClick={() => add(source.location)}>{t('sources.give', { name: agentName })}</button>
          <button type="button" className="text danger" disabled={working} onClick={() => run(async () => {
            await api.removeWorkspace(source.id);
            return api.listAgentSources(agentId);
          })}>{t('sources.forget')}</button>
        </span>
      )}
    </li>
  );

  return (
    <div className="page-stack sources-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">{t('sources.eyebrow')}</span>
          <h1>{t('sources.title', { name: agentName })}</h1>
          <p>{t('sources.description', { name: agentName })}</p>
        </div>
      </header>
      <section className="panel form source-add">
        <label>
          <span>{t('sources.location')}</span>
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') add(); }}
            placeholder={t('sources.locationPlaceholder')}
          />
        </label>
        <div className="source-browse">
          <button type="button" className="secondary" onClick={() => browse(api.pickWorkspaceDirectory)}>
            <Icon name="folder" size={14} />{t('sources.chooseFolder')}
          </button>
          <button type="button" className="secondary" onClick={() => browse(api.pickSourceFile)}>
            <Icon name="file" size={14} />{t('sources.chooseFile')}
          </button>
        </div>
        <label>
          <span>{t('sources.note')}</span>
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder={t('sources.notePlaceholder')} />
        </label>
        <div className="actions">
          <button type="button" className="primary" disabled={!location.trim() || working} onClick={() => add()}>
            <Icon name="plus" size={14} />{t('sources.add')}
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>{t('sources.assigned', { name: agentName })}</h2>
        {list === null ? null : list.assigned.length === 0 ? (
          <p className="muted">{t('sources.none', { name: agentName })}</p>
        ) : (
          <ul className="source-list">{list.assigned.map((source) => row(source, true))}</ul>
        )}
      </section>
      {list && list.unassigned.length > 0 ? (
        <section className="panel">
          <h2>{t('sources.unassigned')}</h2>
          <p className="muted">{t('sources.unassignedHelp')}</p>
          <ul className="source-list">{list.unassigned.map((source) => row(source, false))}</ul>
        </section>
      ) : null}
    </div>
  );
}
