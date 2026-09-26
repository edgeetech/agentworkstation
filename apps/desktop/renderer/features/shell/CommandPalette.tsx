import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { useI18n } from '../../i18n';

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: IconName;
  leading?: JSX.Element;
  shortcut?: string;
  keywords?: string;
  run: () => void;
};

const normalize = (value: string): string => value
  .toLocaleLowerCase('tr')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/ı/g, 'i');

export function CommandPalette({
  items,
  onClose,
}: {
  items: PaletteItem[];
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return items;
    return items.filter((item) => {
      const haystack = normalize(`${item.label} ${item.hint ?? ''} ${item.group} ${item.keywords ?? ''}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item: PaletteItem | undefined): void => {
    if (!item) return;
    onClose();
    item.run();
  };

  let lastGroup = '';
  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('shell.search')}>
        <div className="palette-search">
          <Icon name="search" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={filtered[active] ? `palette-item-${filtered[active]!.id}` : undefined}
            aria-label={t('shell.searchPlaceholder')}
            placeholder={t('shell.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, filtered.length - 1)); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
              else if (event.key === 'Enter') { event.preventDefault(); choose(filtered[active]); }
              else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {filtered.length === 0 ? <p className="palette-empty">{t('shell.noResults', { query })}</p> : null}
          {filtered.map((item, index) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {heading ? <div className="palette-group" role="presentation">{heading}</div> : null}
                <div
                  id={`palette-item-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={`palette-item ${index === active ? 'active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <span className="palette-leading">{item.leading ?? (item.icon ? <Icon name={item.icon} /> : null)}</span>
                  <span className="palette-copy">
                    <strong>{item.label}</strong>
                    {item.hint ? <small>{item.hint}</small> : null}
                  </span>
                  {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
