import type { SourceReference } from '../../../shared/api';

export function EvidencePanel({
  sources,
  onOpenFile,
}: {
  sources: SourceReference[];
  onOpenFile: (source: SourceReference) => void;
}): JSX.Element {
  if (sources.length === 0) {
    return <div className="inspector-empty"><strong>No evidence yet</strong><p>Sources used by this session will appear here.</p></div>;
  }
  return (
    <ul className="evidence-list">
      {sources.map((source, index) => {
        const label = source.label ?? source.relativePath ?? source.commitSha ?? source.workspaceId ?? source.type;
        const canOpen = Boolean(source.workspaceId && source.relativePath && source.type === 'file');
        return (
          <li key={`${source.type}-${source.workspaceId ?? ''}-${source.relativePath ?? ''}-${source.commitSha ?? ''}-${index}`}>
            <span className="evidence-kind">{source.type.replace('_', ' ')}</span>
            <strong>{label}</strong>
            <small>{source.workspaceId ?? 'Career Agent memory'}</small>
            {canOpen ? <button type="button" onClick={() => onOpenFile(source)}>Open file</button> : null}
          </li>
        );
      })}
    </ul>
  );
}
