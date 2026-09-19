import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageContent } from '../../apps/desktop/renderer/features/chat/MessageContent';

describe('MessageContent', () => {
  it('renders useful Markdown structure', () => {
    const html = renderToStaticMarkup(createElement(MessageContent, {
      content: '## Finding\n\n- **Evidence**\n\n`code`',
    }));

    expect(html).toContain('<h2>Finding</h2>');
    expect(html).toContain('<li><strong>Evidence</strong></li>');
    expect(html).toContain('<code>code</code>');
  });

  it('does not execute raw HTML and neutralizes model-authored source links', () => {
    const html = renderToStaticMarkup(createElement(MessageContent, {
      content: '<script>alert(1)</script> [README](source:file:README.md)',
    }));

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('href="source:');
    expect(html).toContain('README');
  });

  it('does not load remote images from model-authored Markdown', () => {
    const html = renderToStaticMarkup(createElement(MessageContent, {
      content: '![tracking pixel](https://example.com/pixel.png)',
    }));

    expect(html).not.toContain('<img');
    expect(html).not.toContain('pixel.png');
    expect(html).toContain('Image reference: tracking pixel');
  });

  it('exposes only web links as actionable anchors', () => {
    const html = renderToStaticMarkup(createElement(MessageContent, {
      content: '[Article](https://example.com/post) [Email](mailto:test@example.com)',
    }));

    expect(html).toContain('href="https://example.com/post"');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('Email');
  });
});
