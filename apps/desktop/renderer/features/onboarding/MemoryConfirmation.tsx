import type { ReactNode } from 'react';
import { useI18n, type Translator, type UiLocale } from '../../i18n';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readableLabel = (key: string, locale: UiLocale): string => {
  const leaf = key.split('.').at(-1) ?? key;
  const known: Record<string, [string, string]> = {
    sources: ['Sources', 'Kaynaklar'],
    publishTarget: ['Publish target', 'Yayın hedefi'],
    socialAccount: ['Social account', 'Sosyal medya hesabı'],
    topicBrief: ['Topic brief', 'Konu özeti'],
    voiceSources: ['Writing examples', 'Yazı örnekleri'],
  };
  if (known[leaf]) return known[leaf][locale === 'tr' ? 1 : 0];
  const spaced = leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const readableType = (value: unknown, t: Translator): string => {
  if (typeof value !== 'string' || !value.trim()) return t('memory.source');
  const normalized = value.trim().toLowerCase();
  if (normalized === 'url') return t('memory.website');
  if (normalized === 'github') return 'GitHub';
  if (normalized === 'linkedin') return 'LinkedIn';
  return value;
};

function scalar(value: unknown, t: Translator): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="memory-empty">{t('memory.notProvided')}</span>;
  if (typeof value === 'boolean') return value ? t('memory.yes') : t('memory.no');
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return null;
}

function ValueSummary({ value, locale, t }: { value: unknown; locale: UiLocale; t: Translator }): JSX.Element {
  if (Array.isArray(value)) {
    return (
      <ul className="memory-value-list">
        {value.map((item, index) => <li key={index}><ValueSummary value={item} locale={locale} t={t} /></li>)}
      </ul>
    );
  }

  if (isRecord(value)) {
    if ('identifier' in value) {
      return (
        <div className="memory-reference">
          <span>{readableType(value.type, t)}</span>
          <strong>{String(value.identifier ?? t('memory.notProvided'))}</strong>
        </div>
      );
    }
    if (Object.keys(value).length === 1 && 'text' in value) {
      return <p className="memory-text">{String(value.text ?? t('memory.notProvided'))}</p>;
    }
    return (
      <dl className="memory-fields">
        {Object.entries(value).map(([key, nested]) => (
          <div key={key}>
            <dt>{readableLabel(key, locale)}</dt>
            <dd><ValueSummary value={nested} locale={locale} t={t} /></dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span>{scalar(value, t)}</span>;
}

export function MemoryConfirmation({ fieldKey, value }: { fieldKey: string; value: unknown }): JSX.Element {
  const { locale, t } = useI18n();
  return (
    <div className="memory-confirmation" aria-label={t('memory.aria')}>
      <span className="memory-confirmation-label">{readableLabel(fieldKey, locale)}</span>
      <ValueSummary value={value} locale={locale} t={t} />
    </div>
  );
}
