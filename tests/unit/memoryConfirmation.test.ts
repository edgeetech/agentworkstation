import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryConfirmation } from '../../apps/desktop/renderer/features/onboarding/MemoryConfirmation';
import { I18nProvider } from '../../apps/desktop/renderer/i18n';

const renderConfirmation = (props: Parameters<typeof MemoryConfirmation>[0]): string =>
  renderToStaticMarkup(createElement(I18nProvider, null, createElement(MemoryConfirmation, props)));

describe('MemoryConfirmation', () => {
  it('renders source arrays as human-readable references rather than JSON', () => {
    const html = renderConfirmation({
      fieldKey: 'career.sources',
      value: [
        { type: 'github', identifier: 'asozyurt' },
        { type: 'linkedin', identifier: 'https://linkedin.com/in/asozyurt' },
      ],
    });

    expect(html).toContain('Sources');
    expect(html).toContain('GitHub');
    expect(html).toContain('asozyurt');
    expect(html).toContain('LinkedIn');
    expect(html).not.toContain('&quot;identifier&quot;');
    expect(html).not.toContain('{');
  });

  it('renders a publication target with a friendly type label', () => {
    const html = renderConfirmation({
      fieldKey: 'blogger.publishTarget',
      value: { type: 'url', identifier: 'https://asozyurt.com' },
    });

    expect(html).toContain('Publish target');
    expect(html).toContain('Website');
    expect(html).toContain('https://asozyurt.com');
  });
});
