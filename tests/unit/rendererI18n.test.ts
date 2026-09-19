import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentWorkstationApi } from '../../apps/desktop/shared/api';
import { I18nProvider } from '../../apps/desktop/renderer/i18n';
import { PublicationSetupPanel } from '../../apps/desktop/renderer/features/publication/PublicationSetupPanel';
import { SessionInspector } from '../../apps/desktop/renderer/features/inspector/SessionInspector';
import { PrivacyPanel } from '../../apps/desktop/renderer/features/inspector/PrivacyPanel';

function setStoredLocale(locale: 'en' | 'tr'): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => locale, setItem: () => undefined },
  });
}

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(I18nProvider, null, element));
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('renderer localization', () => {
  it('renders publication and LinkedIn setup chrome in Turkish', () => {
    setStoredLocale('tr');
    const html = render(createElement(PublicationSetupPanel, {
      api: {} as AgentWorkstationApi,
      workspaces: [],
      onError: () => undefined,
      onNotice: () => undefined,
    }));

    expect(html).toContain('Web sitesi hedefini yapılandır');
    expect(html).toContain('LinkedIn üye hesabında yayınlama');
    expect(html).toContain('Onaylanmış Blogger dosyalarını kullan');
    expect(html).not.toContain('Configure the website target');
  });

  it('renders inspector empty state and privacy labels in Turkish', () => {
    setStoredLocale('tr');
    const emptyInspector = render(createElement(SessionInspector, {
      history: [], additionalSources: [], actions: [], cloudPermitted: false, busy: false,
      listEntries: async () => [],
      readFile: async () => ({ workspaceId: 'site', relativePath: 'README.md', content: '', truncated: false }),
      onApprove: () => undefined,
      onReject: () => undefined,
      onOpenReview: () => undefined,
      onError: () => undefined,
    }));
    const privacy = render(createElement(PrivacyPanel, { cloudPermitted: false, mode: 'standard' }));

    expect(emptyInspector).toContain('Etkin konuşma yok');
    expect(emptyInspector).toContain('Etkin konuşma inceleyicisi');
    expect(privacy).toContain('Zekâ tercihi');
    expect(privacy).toContain('Yalnızca yerel');
    expect(privacy).not.toContain('Intelligence preference');
  });
});
