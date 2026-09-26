import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Icon } from '../shell/icons';

const textOf = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
};

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CodeBlock({ children }: { children?: ReactNode }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(child) ? child.props.className ?? '' : '';
  const language = /language-([\w+-]+)/.exec(className)?.[1];
  const code = textOf(children).replace(/\n$/, '');
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span>{language ?? 'text'}</span>
        <button
          type="button"
          className="code-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={() => {
            void copyText(code).then((ok) => {
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function MessageContent({ content }: { content: string }): JSX.Element {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            if (!href || href.startsWith('source:')) return <span>{children}</span>;
            if (!/^https?:\/\//i.test(href)) return <span>{children}</span>;
            return (
              <a
                href={href}
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void window.agentWorkstation.openExternalLink(href);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ alt }) => (
            <span className="blocked-markdown-image" role="note">
              {alt ? `Image reference: ${alt}` : 'Image reference hidden'}
            </span>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
