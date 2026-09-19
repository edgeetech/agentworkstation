import { useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry, WorkspaceFilePreview } from '../../../shared/api';
import { useI18n } from '../../i18n';

function parentPath(relativePath: string): string {
  const parts = relativePath.split('/').filter((part) => part && part !== '.');
  parts.pop();
  return parts.join('/') || '.';
}

export function FilesPanel({
  workspaceId,
  listEntries,
  readFile,
  requestedFile,
  onError,
}: {
  workspaceId?: string | null;
  listEntries: (workspaceId: string, relativePath: string) => Promise<WorkspaceEntry[]>;
  readFile: (workspaceId: string, relativePath: string) => Promise<WorkspaceFilePreview>;
  requestedFile?: string | null;
  onError: (message: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [directory, setDirectory] = useState('.');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    setDirectory('.');
    setPreview(null);
  }, [workspaceId]);

  useEffect(() => {
    const current = ++request.current;
    setEntries([]);
    setError(null);
    if (!workspaceId) return;
    setLoading(true);
    void listEntries(workspaceId, directory)
      .then((next) => { if (request.current === current) setEntries(next); })
      .catch((value: unknown) => {
        if (request.current !== current) return;
        const message = value instanceof Error ? value.message : String(value);
        setError(message);
        onError(message);
      })
      .finally(() => { if (request.current === current) setLoading(false); });
  }, [directory, listEntries, onError, reloadVersion, workspaceId]);

  const openFile = (relativePath: string): void => {
    if (!workspaceId) return;
    const current = ++request.current;
    setError(null);
    setLoading(true);
    void readFile(workspaceId, relativePath)
      .then((next) => { if (request.current === current) setPreview(next); })
      .catch((value: unknown) => {
        if (request.current !== current) return;
        const message = value instanceof Error ? value.message : String(value);
        setError(message);
        onError(message);
      })
      .finally(() => { if (request.current === current) setLoading(false); });
  };

  useEffect(() => {
    if (!requestedFile || !workspaceId) return;
    openFile(requestedFile);
    // requestedFile is an explicit navigation event; API functions are stable preload methods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedFile, workspaceId]);

  if (!workspaceId) {
    return <div className="inspector-empty"><strong>{t('inspector.noWorkspace')}</strong><p>{t('inspector.noWorkspaceHelp')}</p></div>;
  }
  return (
    <div className="files-panel">
      <div className="file-breadcrumb">
        <button type="button" aria-label={t('inspector.parentDirectory')} disabled={directory === '.'} onClick={() => { setPreview(null); setDirectory(parentPath(directory)); }}>←</button>
        <span>{workspaceId} / {directory === '.' ? '' : directory}</span>
      </div>
      {error ? (
        <div className="inspector-error" role="alert">
          <strong>{t('inspector.filesUnavailable')}</strong>
          <p>{error}</p>
          <button type="button" onClick={() => { setPreview(null); setReloadVersion((value) => value + 1); }}>{t('inspector.reloadDirectory')}</button>
        </div>
      ) : preview ? (
        <div className="file-preview">
          <div><button type="button" onClick={() => setPreview(null)}>{t('inspector.backToFiles')}</button><strong>{preview.relativePath}</strong></div>
          {preview.truncated ? <small>{t('inspector.previewLimit')}</small> : null}
          <pre>{preview.content}</pre>
        </div>
      ) : loading ? <div className="inspector-loading" role="status">{t('inspector.loadingFiles')}</div> : entries.length === 0 ? (
        <div className="inspector-empty"><strong>{t('inspector.nothing')}</strong><p>{t('inspector.nothingHelp')}</p></div>
      ) : (
        <ul className="file-list">
          {entries.map((entry) => (
            <li key={entry.relativePath}>
              <button type="button" onClick={() => entry.kind === 'directory'
                ? setDirectory(entry.relativePath)
                : openFile(entry.relativePath)}>
                <span aria-hidden="true">{entry.kind === 'directory' ? '▸' : '·'}</span>
                <span>{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
