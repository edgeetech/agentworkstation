import ReactMarkdown from 'react-markdown';

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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
