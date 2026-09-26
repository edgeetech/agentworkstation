const initials = (name: string): string => name
  .split(/\s+/)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();

export function SpecialistAvatar({
  agentId,
  name,
  large = false,
}: {
  agentId: string;
  name: string;
  large?: boolean;
}): JSX.Element {
  const className = `agent-avatar specialist-avatar agent-tone-${agentId}${large ? ' large' : ''}`;

  if (agentId === 'career') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M8 7V5.8C8 4.8 8.8 4 9.8 4h4.4c1 0 1.8.8 1.8 1.8V7" />
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M4 11.5c2.4 1.4 5.1 2.1 8 2.1s5.6-.7 8-2.1M10 13.6v1.8h4v-1.8" />
        </svg>
      </span>
    );
  }

  if (agentId === 'blogger') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M5 19c3.2-6.9 7.4-11.5 13-14 1.2 4.2-.1 8-3.8 11.2-2.2 1.9-5.2 2.2-7.2 1.4" />
          <path d="m7 17 8.5-8.5M10.2 13.8l-1.8-3M13.1 10.9l3.2.6M5 20h9" />
        </svg>
      </span>
    );
  }

  if (agentId === 'accountant') {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
          <path d="M8.5 7.5h7M8.5 11h1.5M12 11h1.5M15.5 11h0M8.5 14.5h1.5M12 14.5h1.5M8.5 17.5h5M15.5 14.5v3" />
        </svg>
      </span>
    );
  }

  return <span className={className} aria-hidden="true">{initials(name)}</span>;
}
