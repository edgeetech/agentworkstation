import type { ReactNode } from 'react';

export type IconName =
  | 'plus' | 'search' | 'sidebar' | 'panel' | 'settings' | 'sun' | 'moon' | 'monitor'
  | 'copy' | 'check' | 'arrowUp' | 'arrowDown' | 'stop' | 'chevron' | 'more' | 'folder'
  | 'file' | 'commit' | 'globe' | 'sparkle' | 'pencil' | 'shield' | 'bolt' | 'command'
  | 'review' | 'audit' | 'chat' | 'send' | 'x';

const paths: Record<IconName, ReactNode> = {
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  search: <><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5" /></>,
  sidebar: <><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M8 4v12" /></>,
  panel: <><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M12 4v12" /></>,
  settings: <><path d="M4 6h7M15 6h1M4 14h1M9 14h7" /><circle cx="13" cy="6" r="2" /><circle cx="7" cy="14" r="2" /></>,
  sun: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" /></>,
  moon: <path d="M15.8 12.4A6.4 6.4 0 0 1 7.6 4.2a6.4 6.4 0 1 0 8.2 8.2Z" />,
  monitor: <><rect x="3" y="4" width="14" height="9.5" rx="2" /><path d="M7.5 16.5h5M10 13.5v3" /></>,
  copy: <><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></>,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  arrowUp: <path d="M10 16V4.5m0 0L5 9.5m5-5 5 5" />,
  arrowDown: <path d="M10 4v11.5m0 0 5-5m-5 5-5-5" />,
  stop: <rect x="6" y="6" width="8" height="8" rx="1.6" fill="currentColor" stroke="none" />,
  chevron: <path d="m5.5 8 4.5 4.5L14.5 8" />,
  more: <><circle cx="5" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none" /></>,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2l1.6 1.8h6.2A1.5 1.5 0 0 1 17 8.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5Z" />,
  file: <><path d="M5.5 3h6L15 6.5v9A1.5 1.5 0 0 1 13.5 17h-8A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3Z" /><path d="M11 3v4h4" /></>,
  commit: <><circle cx="10" cy="10" r="3" /><path d="M3 10h4M13 10h4" /></>,
  globe: <><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2.2 2.8 4.5 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.5-2.8-7S8 5.2 10 3Z" /></>,
  sparkle: <path d="M10 3.5c.5 3.4 3 6 6.5 6.5-3.5.5-6 3.1-6.5 6.5-.5-3.4-3-6-6.5-6.5 3.5-.5 6-3.1 6.5-6.5Z" />,
  pencil: <path d="m12.5 4.5 3 3L8 15H5v-3Z" />,
  shield: <path d="M10 3 16 5.5v4.2c0 3.6-2.5 6.1-6 7.3-3.5-1.2-6-3.7-6-7.3V5.5Z" />,
  bolt: <path d="M11 3 5 11h4.5L9 17l6-8h-4.5Z" />,
  command: <path d="M7 7h6v6H7Zm0 0V5.5A1.5 1.5 0 1 0 5.5 7Zm6 0V5.5A1.5 1.5 0 1 1 14.5 7Zm0 6v1.5a1.5 1.5 0 1 0 1.5-1.5Zm-6 0v1.5A1.5 1.5 0 1 1 5.5 13Z" />,
  review: <><path d="M5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3Z" /><path d="m7 10 2 2 4-4.5" /></>,
  audit: <><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5M7 9h4M9 7v4" /></>,
  chat: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6.5a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 12Z" />,
  send: <path d="M10 16V4.5m0 0L5 9.5m5-5 5 5" />,
  x: <path d="m5.5 5.5 9 9m0-9-9 9" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
