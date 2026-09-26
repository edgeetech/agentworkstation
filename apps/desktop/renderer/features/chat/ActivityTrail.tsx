import { useEffect, useState } from 'react';
import type { ChatActivity } from '../../../shared/api';
import { Icon, type IconName } from '../shell/icons';
import { useI18n, type Translator } from '../../i18n';

type Step = { key: string; label: string; icon: IconName; failed?: boolean };

const shortTarget = (target: string): string => {
  const clean = target.replace(/^https?:\/\//, '');
  return clean.length > 56 ? `…${clean.slice(-54)}` : clean;
};

export function describeActivity(activity: ChatActivity, t: Translator): Step | null {
  if (activity.type === 'text_delta') return null;
  if (activity.type === 'thinking') {
    return {
      key: `thinking-${activity.step}`,
      label: activity.step === 0 ? t('chat.activityThinking') : t('chat.activityThinkingAgain'),
      icon: 'sparkle',
    };
  }
  const tool = activity.toolName;
  if (activity.type === 'tool_failed') {
    return { key: `failed-${activity.step}`, label: t('chat.activityFailed', { tool }), icon: 'x', failed: true };
  }
  const target = activity.target ? shortTarget(activity.target) : undefined;
  const key = `tool-${activity.step}`;
  if (/web/i.test(tool)) return { key, label: t('chat.activityWeb', { target: target ?? 'web page' }), icon: 'globe' };
  if (/git\.log/i.test(tool)) return { key, label: t('chat.activityGitLog'), icon: 'commit' };
  if (/git\.status/i.test(tool)) return { key, label: t('chat.activityGitStatus'), icon: 'commit' };
  if (/git\.diff/i.test(tool)) return { key, label: t('chat.activityGitDiff'), icon: 'commit' };
  if (/propose|write/i.test(tool)) return { key, label: t('chat.activityPropose'), icon: 'pencil' };
  if (target) return { key, label: t('chat.activityRead', { target }), icon: 'file' };
  return { key, label: t('chat.activityTool', { tool }), icon: 'bolt' };
}

export function ActivityTrail({ activity, startedAt }: { activity: ChatActivity[]; startedAt: number }): JSX.Element {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const steps = activity
    .map((item) => describeActivity(item, t))
    .filter((step): step is Step => step !== null);
  const visible = steps.length ? steps : [{ key: 'start', label: t('chat.activityThinking'), icon: 'sparkle' as const }];
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <ol className="activity-trail" aria-live="polite">
      {visible.map((step, index) => {
        const current = index === visible.length - 1;
        return (
          <li key={step.key} className={`${current ? 'current' : 'done'}${step.failed ? ' failed' : ''}`}>
            <span className="activity-icon"><Icon name={current || step.failed ? step.icon : 'check'} size={14} /></span>
            <span className="activity-label">{step.label}</span>
            {current && seconds >= 2 ? <span className="activity-time">{t('chat.elapsed', { seconds })}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
