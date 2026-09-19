import type { SourceReference } from '../../../shared/api';
import { useI18n } from '../../i18n';

export function EvidencePanel({
  sources,
  onOpenFile,
}: {
  sources: SourceReference[];
  onOpenFile: (source: SourceReference) => void;
}): JSX.Element {
  const { t } = useI18n();
  if (sources.length === 0) {
    return <div className="inspector-empty"><strong>{t('inspector.noEvidence')}</strong><p>{t('inspector.noEvidenceHelp')}</p></div>;
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
            <small>{source.workspaceId ?? t('inspector.savedMemory')}</small>
            {canOpen ? <button type="button" onClick={() => onOpenFile(source)}>{t('inspector.openFile')}</button> : null}
          </li>
        );
      })}
    </ul>
  );
}
