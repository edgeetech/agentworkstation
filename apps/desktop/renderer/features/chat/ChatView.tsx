import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AgentSummary,
  ChatActivity,
  ChatContextUsage,
  ChatExchange,
  ChatMode,
  ChatSessionRecord,
  OnboardingStep,
  ProposalTally,
} from '../../../shared/api';
import { MessageContent, copyText } from './MessageContent';
import { ActivityTrail } from './ActivityTrail';
import { SpecialistAvatar } from '../agents/SpecialistAvatar';
import { MemoryConfirmation } from '../onboarding/MemoryConfirmation';
import { Icon } from '../shell/icons';
import { useI18n, type MessageKey, type Translator } from '../../i18n';
import { routeBadgeLabel, routeBadgeTooltip } from '../intelligence/providerSelection';

export type PendingChat = { sessionId: string; requestId: string; prompt: string; mode: ChatMode; startedAt: number };
export type FailedChat = { sessionId: string; prompt: string; message: string; mode: ChatMode };

const onboardingPromptKeys: Record<string, MessageKey> = {
  'choose-career-sources': 'chat.onboardingCareerSources',
  'choose-additional-career-sources': 'chat.onboardingCareerAdditional',
  'choose-career-publish-target': 'chat.onboardingCareerPublish',
  'choose-career-social-account': 'chat.onboardingCareerLinkedIn',
  'choose-blog-topic': 'chat.onboardingBloggerTopic',
  'choose-writing-sources': 'chat.onboardingBloggerSources',
  'choose-blog-publish-target': 'chat.onboardingBloggerPublish',
  'choose-blog-social-account': 'chat.onboardingBloggerLinkedIn',
};

const contextSize = (bytes: number): string => `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;

const sourceLabel = (source: ChatExchange['sourceReferences'][number], t: Translator): string =>
  source.label ?? source.url ?? source.relativePath ?? source.commitSha ?? source.workspaceId ?? t('app.localEvidence');

const routeLabel = (route: NonNullable<ChatExchange['route']>, t: Translator): string =>
  routeBadgeLabel(
    route, t('chat.providerSelectedModel'), t('chat.simulatedModel'),
    (cost) => t('chat.modelCost', { cost }), t('chat.modelCostNA'),
  );

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reveals a freshly arrived reply progressively so it reads like it is being written. */
function RevealText({ content, onDone, onProgress }: { content: string; onDone: () => void; onProgress: () => void }): JSX.Element {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? content.length : 0));
  const done = useRef(onDone);
  const progress = useRef(onProgress);
  done.current = onDone;
  progress.current = onProgress;
  useEffect(() => {
    if (shown >= content.length) {
      done.current();
      return undefined;
    }
    const step = Math.max(4, Math.ceil(content.length / 80));
    const frame = window.requestAnimationFrame(() => {
      setShown((value) => {
        const next = Math.min(content.length, value + step);
        const boundary = content.indexOf(' ', next);
        return boundary > 0 && boundary - next < 12 ? boundary : next;
      });
      progress.current();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content, shown]);
  return <MessageContent content={content.slice(0, shown)} />;
}

function ModeIcon({ mode }: { mode: ChatMode }): JSX.Element {
  const { t } = useI18n();
  const label = mode === 'autopilot' ? t('sidebar.autopilot') : t('sidebar.standard');
  return (
    <span className={`prompt-mode-icon ${mode}`} aria-label={t('app.mode', { mode: label })} title={t('app.mode', { mode: label })}>
      <Icon name={mode === 'autopilot' ? 'sparkle' : 'chat'} size={12} />
    </span>
  );
}

function UserTurn({ prompt, mode }: { prompt: string; mode: ChatMode }): JSX.Element {
  return (
    <div className="user-turn">
      <div className="message user"><p>{prompt}</p></div>
      <ModeIcon mode={mode} />
    </div>
  );
}

function CopyButton({ text }: { text: string }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="message-action"
      aria-label={copied ? t('chat.copied') : t('chat.copy')}
      title={copied ? t('chat.copied') : t('chat.copy')}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
    </button>
  );
}

function ContextUsageIndicator({ usage }: { usage: ChatContextUsage | null }): JSX.Element {
  const { t } = useI18n();
  const percentage = usage?.percentage ?? 0;
  const label = usage
    ? `${percentage}% context used, ${contextSize(usage.usedBytes)} of ${contextSize(usage.limitBytes)}`
    : t('app.contextUnavailableRestart');
  return (
    <span
      className={`context-usage ${usage ? '' : 'unavailable'}`}
      data-testid="context-usage"
      tabIndex={0}
      aria-label={label}
      style={{ '--context-percentage': `${percentage}%` } as React.CSSProperties}
    >
      <span className="context-pie" aria-hidden="true" />
      <span className="context-tooltip" role="tooltip">
        <strong>{usage ? t('app.contextUsed', { percentage }) : t('app.contextUnavailable')}</strong>
        <span>{usage ? t('app.contextBudget', { used: contextSize(usage.usedBytes), limit: contextSize(usage.limitBytes) }) : t('app.restartIndicator')}</span>
        {usage?.truncatedSections.length ? <em>{t('app.contextTrimmed')}</em> : null}
      </span>
    </span>
  );
}

export function ChatView({
  agent,
  agentName,
  session,
  history,
  onboardingStep,
  proposalTally,
  pending,
  activity,
  failure,
  freshReply,
  draft,
  busy,
  contextUsage,
  connectPanel,
  onDraftChange,
  onSend,
  onCancel,
  onChangeMode,
  onAddFolder,
  onEditMemory,
  onManageSources,
  onRevealDone,
}: {
  agent?: AgentSummary;
  agentName: string;
  session?: ChatSessionRecord;
  history: ChatExchange[];
  onboardingStep: OnboardingStep | null;
  proposalTally: ProposalTally | null;
  pending: PendingChat | null;
  activity: ChatActivity[];
  failure: FailedChat | null;
  freshReply: string | null;
  draft: string;
  busy: boolean;
  contextUsage: ChatContextUsage | null;
  connectPanel?: ReactNode;
  onDraftChange: (value: string) => void;
  onSend: (prompt?: string, mode?: ChatMode) => void;
  onCancel: () => void;
  onChangeMode: (mode: ChatMode) => void;
  onAddFolder: () => void;
  onEditMemory: () => void;
  onManageSources: () => void;
  onRevealDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const modeMenu = useRef<HTMLDetailsElement>(null);
  const addMenu = useRef<HTMLDetailsElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const agentId = agent?.id ?? 'unknown';
  const onboardingActive = onboardingStep !== null && onboardingStep.kind !== 'complete';
  const empty = history.length === 0 && !pending && !failure;

  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      if (!modeMenu.current?.contains(event.target as Node)) modeMenu.current?.removeAttribute('open');
      if (!addMenu.current?.contains(event.target as Node)) addMenu.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  const scrollToEnd = (behavior: ScrollBehavior = 'auto'): void => {
    const element = scroller.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  };

  useLayoutEffect(() => {
    pinned.current = true;
    scrollToEnd();
  }, [session?.id]);

  useLayoutEffect(() => {
    if (pinned.current) scrollToEnd();
  }, [history, pending, failure, activity, onboardingStep]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [draft]);

  useEffect(() => {
    textarea.current?.focus();
  }, [session?.id]);

  const onboardingKey = onboardingStep?.kind === 'question' ? onboardingPromptKeys[onboardingStep.question.id] : undefined;
  const onboardingQuestion = onboardingStep?.kind === 'question'
    ? onboardingKey ? t(onboardingKey) : onboardingStep.question.prompt
    : null;
  const suggestions = onboardingStep?.kind === 'question' && onboardingStep.question.intent === 'initial'
    ? onboardingStep.question.optional
      ? [t('chat.noMoreSources')]
      : agentId === 'career'
        ? [t('chat.github'), t('chat.linkedin'), t('chat.cv'), t('chat.describeSelf')]
        : agentId === 'blogger'
          ? [t('chat.publishedArticles'), t('chat.writingFolder'), t('chat.describeStyle')]
          : []
    : [];

  const fillPrompt = (prompt: string): void => {
    onDraftChange(prompt);
    window.requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(prompt.length, prompt.length);
    });
  };

  const onboardingCard = onboardingActive && !pending ? (
    <section className={`onboarding-card ${empty ? 'as-greeting' : ''}`} aria-label={`${agentName} setup question`}>
      {empty ? <SpecialistAvatar agentId={agentId} name={agentName} large /> : null}
      {onboardingStep.kind === 'question' ? (
        <>
          <h2 className="onboarding-question">{onboardingQuestion}</h2>
          <p className="onboarding-help">{t('chat.naturalAnswer', { name: agentName })}</p>
          {suggestions.length ? (
            <div className="onboarding-suggestions" aria-label={t('chat.examples')}>
              {suggestions.map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => fillPrompt(suggestion)}>{suggestion}</button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <h2 className="onboarding-question">{t('chat.confirmTitle')}</h2>
          <MemoryConfirmation fieldKey={onboardingStep.memory.fieldKey} value={onboardingStep.memory.value} />
          <div className="onboarding-suggestions">
            <button className="primary" type="button" onClick={() => onSend('evet')}>{t('chat.confirmYes')}</button>
            <button type="button" onClick={() => onSend('hayır')}>{t('chat.confirmNo')}</button>
          </div>
        </>
      )}
    </section>
  ) : null;

  const greeting = empty && !onboardingActive ? (
    <div className="chat-welcome">
      <SpecialistAvatar agentId={agentId} name={agentName} large />
      <h1>{t('chat.helpTitle', { name: agentName })}</h1>
      <p>{agent?.description ?? t('chat.chooseContext')}</p>
      {agent?.quickActions.length ? (
        <div className="starter-grid" aria-label={t('chat.starters')}>
          {agent.quickActions.slice(0, 4).map((action) => (
            <button type="button" key={action.id} className="starter" onClick={() => fillPrompt(action.prompt)}>
              <strong>{action.title}</strong>
              <span>{action.prompt}</span>
            </button>
          ))}
        </div>
      ) : null}
      <p className="chat-welcome-note">
        <Icon name="shield" size={14} />
        <span>{t('chat.approvalNotice')}</span>
      </p>
      {proposalTally && proposalTally.total > 0 ? (
        <p className="proposal-tally">
          {t('chat.proposalTally', {
            limit: String(proposalTally.total),
            approved: String(proposalTally.approved),
            rejected: String(proposalTally.rejected),
          })}
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={`chatgpt-chat ${empty ? 'is-empty' : ''}`}>
      <div
        className="conversation"
        ref={scroller}
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
          pinned.current = distance < 80;
          setShowJump(distance > 240);
        }}
      >
        <div className="conversation-content">
          {greeting}
          {history.map((exchange, index) => {
            const isLiveOnboardingEcho = onboardingActive && index === history.length - 1;
            const isFresh = freshReply !== null && index === history.length - 1 && exchange.assistantMessage === freshReply;
            return (
              <div className="exchange" key={`${index}-${exchange.userMessage.slice(0, 24)}`}>
                <UserTurn prompt={exchange.userMessage} mode={exchange.mode} />
                {isLiveOnboardingEcho ? null : (
                  <div className="message assistant">
                    <span className="assistant-name">{agentName}</span>
                    {isFresh
                      ? <RevealText content={exchange.assistantMessage} onDone={onRevealDone} onProgress={() => { if (pinned.current) scrollToEnd(); }} />
                      : <MessageContent content={exchange.assistantMessage} />}
                    {exchange.sourceReferences.length ? (
                      <div className="chips">
                        {exchange.sourceReferences.map((source, sourceIndex) => (
                          <span key={`${source.type}-${sourceIndex}`}>{sourceLabel(source, t)}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="message-footer">
                      {exchange.route ? (
                        <div
                          className="model-status"
                          aria-label={t('chat.modelUsed', { model: routeLabel(exchange.route, t) })}
                          title={routeBadgeTooltip(exchange.route, (cost) => t('chat.modelCost', { cost }), t('chat.modelCostNA'))}
                        >
                          <i aria-hidden="true" />
                          <span>{routeLabel(exchange.route, t)}</span>
                          {exchange.route.fallback ? <em>{t('chat.fallback')}</em> : null}
                        </div>
                      ) : null}
                      <CopyButton text={exchange.assistantMessage} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {failure ? (
            <div className="exchange failed-exchange">
              <UserTurn prompt={failure.prompt} mode={failure.mode} />
              <div className="message assistant error-message" role="alert">
                <span className="assistant-name">{agentName}</span>
                <strong>{/HTTP\s+429/i.test(failure.message) ? t('chat.usageLimit') : t('chat.failed')}</strong>
                <p>{failure.message}</p>
                <small>{t('chat.notLost')}</small>
                <button type="button" className="secondary retry-message" onClick={() => onSend(failure.prompt, failure.mode)}>
                  {t('chat.tryAgain')}
                </button>
              </div>
            </div>
          ) : null}
          {pending ? (
            <div className="exchange pending-exchange">
              <UserTurn prompt={pending.prompt} mode={pending.mode} />
              <div className="message assistant thinking-message" role="status" aria-label={t('chat.thinking', { name: agentName })}>
                <span className="assistant-name">{agentName}</span>
                <ActivityTrail activity={activity} startedAt={pending.startedAt} />
                <button type="button" className="secondary cancel-message" onClick={onCancel}>{t('common.cancel')}</button>
              </div>
            </div>
          ) : null}
          {onboardingCard}
        </div>
      </div>
      <div className="composer-dock">
        {showJump ? (
          <button type="button" className="jump-latest" aria-label={t('chat.jumpToLatest')} onClick={() => { pinned.current = true; scrollToEnd('smooth'); }}>
            <Icon name="arrowDown" size={16} />
          </button>
        ) : null}
        {connectPanel}
        <form className="composer" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
          <textarea
            ref={textarea}
            rows={1}
            aria-label={t('chat.message', { name: agentName })}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={t('chat.message', { name: agentName })}
          />
          <div className="composer-footer">
            <div className="composer-controls">
              <details className="composer-popover" ref={addMenu} onKeyDown={(event) => { if (event.key === 'Escape') addMenu.current?.removeAttribute('open'); }}>
                <summary className="composer-add" aria-label={t('chat.addContext')} title={t('chat.addContext')}><Icon name="plus" /></summary>
                <div className="composer-popover-content add-popover">
                  <button type="button" onClick={() => { addMenu.current?.removeAttribute('open'); onAddFolder(); }}><Icon name="folder" size={16} />{t('chat.addWorkspace')}</button>
                  <button type="button" onClick={() => { addMenu.current?.removeAttribute('open'); onEditMemory(); }}><Icon name="pencil" size={16} />{t('chat.editMemory')}</button>
                  <button type="button" onClick={() => { addMenu.current?.removeAttribute('open'); onManageSources(); }}><Icon name="settings" size={16} />{t('chat.manageSources')}</button>
                </div>
              </details>
              <details className="composer-popover" ref={modeMenu} onKeyDown={(event) => { if (event.key === 'Escape') modeMenu.current?.removeAttribute('open'); }}>
                <summary className="composer-mode" aria-label={t('chat.mode')}>
                  <Icon name={session?.mode === 'autopilot' ? 'sparkle' : 'chat'} size={14} />
                  {session?.mode === 'autopilot' ? t('sidebar.autopilot') : t('sidebar.standard')}
                  <span className="mode-chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span>
                </summary>
                <div className="composer-popover-content mode-popover" role="group" aria-label={t('chat.mode')}>
                  {(['standard', 'autopilot'] as ChatMode[]).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={session?.mode === mode ? 'selected' : ''}
                      aria-pressed={session?.mode === mode}
                      disabled={!session || busy}
                      onClick={() => { modeMenu.current?.removeAttribute('open'); onChangeMode(mode); }}
                    >
                      <span className="mode-choice-mark" aria-hidden="true"><Icon name={mode === 'autopilot' ? 'sparkle' : 'chat'} size={16} /></span>
                      <span>
                        <strong>{mode === 'standard' ? t('sidebar.standard') : t('sidebar.autopilot')}</strong>
                        <small>{t(mode === 'standard' ? 'chat.standardDescription' : 'chat.autopilotDescription')}</small>
                      </span>
                      {session?.mode === mode ? <span className="mode-selected" aria-hidden="true"><Icon name="check" size={16} /></span> : null}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            <div className="composer-controls">
              <ContextUsageIndicator usage={contextUsage} />
              {pending ? (
                <button type="button" className="primary send-icon stop" aria-label={t('chat.stop')} title={t('chat.stop')} onClick={onCancel}>
                  <Icon name="stop" />
                </button>
              ) : (
                <button className="primary send-icon" aria-label={t('chat.send')} disabled={!session || busy || !draft.trim()}>
                  <Icon name="arrowUp" />
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="composer-hint">{t('chat.composerHint')}</p>
      </div>
    </div>
  );
}
