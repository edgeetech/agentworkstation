import { useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry, WorkspaceFilePreview } from '../../../shared/api';

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
  const [directory, setDirectory] = useState('.');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    setDirectory('.');
    setPreview(null);
  }, [workspaceId]);

  useEffect(() => {
    const current = ++request.current;
    setEntries([]);
    if (!workspaceId) return;
    setLoading(true);
    void listEntries(workspaceId, directory)
      .then((next) => { if (request.current === current) setEntries(next); })
      .catch((value: unknown) => { if (request.current === current) onError(value instanceof Error ? value.message : String(value)); })
      .finally(() => { if (request.current === current) setLoading(false); });
  }, [directory, listEntries, onError, workspaceId]);

  const openFile = (relativePath: string): void => {
    if (!workspaceId) return;
    const current = ++request.current;
    setLoading(true);
    void readFile(workspaceId, relativePath)
      .then((next) => { if (request.current === current) setPreview(next); })
      .catch((value: unknown) => { if (request.current === current) onError(value instanceof Error ? value.message : String(value)); })
      .finally(() => { if (request.current === current) setLoading(false); });
  };

  useEffect(() => {
    if (!requestedFile || !workspaceId) return;
    openFile(requestedFile);
    // requestedFile is an explicit navigation event; API functions are stable preload methods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedFile, workspaceId]);

  if (!workspaceId) {
    return <div className="inspector-empty"><strong>No workspace</strong><p>Create or select a workspace session to browse files.</p></div>;
  }
  return (
    <div className="files-panel">
      <div className="file-breadcrumb">
        <button type="button" disabled={directory === '.'} onClick={() => { setPreview(null); setDirectory(parentPath(directory)); }}>←</button>
        <span>{workspaceId} / {directory === '.' ? '' : directory}</span>
      </div>
      {preview ? (
        <div className="file-preview">
          <div><button type="button" onClick={() => setPreview(null)}>Back to files</button><strong>{preview.relativePath}</strong></div>
          {preview.truncated ? <small>Preview limited to 64 KB.</small> : null}
          <pre>{preview.content}</pre>
        </div>
      ) : loading ? <div className="inspector-loading" role="status">Loading files…</div> : entries.length === 0 ? (
        <div className="inspector-empty"><strong>Nothing to show</strong><p>This directory is empty or contains only protected files.</p></div>
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
