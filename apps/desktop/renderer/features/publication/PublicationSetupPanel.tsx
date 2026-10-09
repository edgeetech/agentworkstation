import React, { useCallback, useEffect, useState } from "react";
import type {
  AgentWorkstationApi,
  PublicationCandidate,
  PublicationCandidateLanguage,
  PublicationSetup,
  WorkspaceRecord,
} from "../../../shared/api";
import { MessageContent } from "../chat/MessageContent";
import { useI18n, type Translator } from "../../i18n";

type Props = { api: AgentWorkstationApi; workspaces: WorkspaceRecord[]; onError: (message: string) => void; onNotice: (message: string) => void };
const errorMessage = (value: unknown): string => value instanceof Error ? value.message : String(value);
const lines = (value: string): string[] => value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
const stageLabel = (stage: string, t: Translator): string => ({
  SITE_APPROVAL_PENDING: t('publication.stage.siteApprovalPending'),
  SITE_APPROVED: t('publication.stage.siteApproved'),
  SITE_PUBLICATION_AWAITING_VERIFICATION: t('publication.stage.siteAwaitingVerification'),
  SITE_PUBLISHED_VERIFIED: t('publication.stage.siteVerified'),
  LINKEDIN_APPROVAL_PENDING: t('publication.stage.linkedinApprovalPending'),
  LINKEDIN_APPROVED: t('publication.stage.linkedinApproved'),
  LINKEDIN_SHARE_AWAITING_VERIFICATION: t('publication.stage.linkedinAwaitingVerification'),
  LINKEDIN_SHARED_VERIFIED: t('publication.stage.linkedinVerified'),
}[stage] ?? stage.replaceAll("_", " ").toLowerCase());
const connectionStateLabel = (state: string, t: Translator): string => ({
  connected: t('publication.state.connected'),
  connecting: t('publication.state.connecting'),
  disconnected: t('publication.state.disconnected'),
  expired: t('publication.state.expired'),
  error: t('publication.state.error'),
}[state] ?? state);
const artifactRoleLabel = (role: string, t: Translator): string => ({
  'primary-article': t('publication.role.primaryArticle'),
  translation: t('publication.role.translation'),
  'visual-asset': t('publication.role.visualAsset'),
  'other-asset': t('publication.role.otherAsset'),
}[role] ?? role.replaceAll('-', ' '));
const fileSize = (bytes: number): string => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

function CandidatePreview({ candidate, primaryLanguage, onPrimaryLanguage }: {
  candidate: PublicationCandidate;
  primaryLanguage: PublicationCandidateLanguage;
  onPrimaryLanguage?: (language: PublicationCandidateLanguage) => void;
}): JSX.Element {
  const { t } = useI18n();
  return <div className="publication-candidate-preview">
    {onPrimaryLanguage ? <fieldset className="publication-primary-language">
      <legend>{t('publication.pageLanguage')}</legend>
      {(["tr", "en"] as const).map((language) => <label key={language}>
        <input type="radio" name="primary-publication-language" checked={primaryLanguage === language} onChange={() => onPrimaryLanguage(language)} />
        {language === "tr" ? t('common.turkish') : t('common.english')}
      </label>)}
    </fieldset> : null}
    <div className="publication-previews">
      {(["tr", "en"] as const).map((language) => {
        const article = candidate.articles[language];
        const languageLabel = language === "tr" ? t('common.turkish') : t('common.english');
        return <article key={language} aria-label={t('publication.articlePreview', { language: languageLabel })}>
          <span className="pill">{language === "tr" ? t('common.turkish') : t('common.english')}</span>
          <h3>{article.title}</h3>
          {article.description ? <p>{article.description}</p> : null}
          <div className="publication-article-preview"><MessageContent content={article.preview} /></div>
        </article>;
      })}
    </div>
    {candidate.visuals.length ? <section className="publication-visuals" aria-label={t('publication.approvedVisuals')}>
      <h3>{t('publication.originalVisual')}</h3>
      {candidate.visuals.map((visual) => <div key={visual.path}>
        <strong>{visual.name}</strong>
        <span>{visual.format} · {fileSize(visual.byteLength)}{visual.width && visual.height ? ` · ${visual.width} × ${visual.height}` : ""}</span>
        <small>{visual.altText ? t('publication.altText', { text: visual.altText }) : t('publication.noAlt')}</small>
      </div>)}
    </section> : <div className="privacy-callout"><strong>{t('publication.noVisual')}</strong><span>{t('publication.noVisualHelp')}</span></div>}
    <details className="settings-details publication-file-details">
      <summary>{t('publication.fileDetails')}</summary>
      <ul>
        <li>{t('publication.turkishFile')}: {candidate.articles.tr.path} ({fileSize(candidate.articles.tr.byteLength)})</li>
        <li>{t('publication.englishFile')}: {candidate.articles.en.path} ({fileSize(candidate.articles.en.byteLength)})</li>
        {candidate.visuals.map((visual) => <li key={visual.path}>{t('publication.visualFile')}: {visual.path}</li>)}
      </ul>
    </details>
  </div>;
}

export function PublicationSetupPanel({ api, workspaces, onError, onNotice }: Props): JSX.Element {
  const { locale, t } = useI18n();
  const [setup, setSetup] = useState<PublicationSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayDomain, setDisplayDomain] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [contentDirectory, setContentDirectory] = useState("src/content/writing");
  const [publishBranch, setPublishBranch] = useState("main");
  const [approvedAssetDirectories, setApprovedAssetDirectories] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [linkedInClientId, setLinkedInClientId] = useState("");
  const [linkedInApiVersion, setLinkedInApiVersion] = useState("202608");
  const [linkedInCommentary, setLinkedInCommentary] = useState("");
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false);
  const [contentId, setContentId] = useState("");
  const [primaryArticlePath, setPrimaryArticlePath] = useState("");
  const [translationPaths, setTranslationPaths] = useState("");
  const [visualAssetPaths, setVisualAssetPaths] = useState("");
  const [otherAssetPaths, setOtherAssetPaths] = useState("");
  const [candidates, setCandidates] = useState<PublicationCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState<PublicationCandidateLanguage>("tr");
  const [candidateSearchComplete, setCandidateSearchComplete] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const applySetup = useCallback((next: PublicationSetup): void => {
    setSetup(next);
    setDisplayDomain(next.siteTarget?.displayDomain ?? "");
    setWorkspaceId(next.siteTarget?.workspaceId ?? workspaces[0]?.id ?? "");
    setContentDirectory(next.siteTarget?.contentDirectory ?? "src/content/writing");
    setPublishBranch(next.siteTarget?.publishBranch ?? "main");
    setApprovedAssetDirectories(next.siteTarget?.approvedAssetDirectories?.join("\n") ?? "");
    setPublicBaseUrl(next.siteTarget?.publicBaseUrl ?? "");
    setLinkedInClientId(next.linkedInConfiguration?.clientId ?? "");
    setLinkedInApiVersion(next.linkedInConfiguration?.apiVersion ?? "202608");
  }, [workspaces]);

  const refresh = useCallback(async (): Promise<void> => { applySetup(await api.getPublicationSetup()); }, [api, applySetup]);
  const refreshCandidates = useCallback(async (): Promise<void> => {
    setCandidatesLoading(true);
    try {
      const next = await api.listPublicationCandidates();
      setCandidates(next);
      setCandidateSearchComplete(true);
      const selected = next[0];
      setSelectedCandidateId(selected?.id ?? "");
      if (selected) setPrimaryLanguage(selected.recommendedPrimaryLanguage);
    } finally {
      setCandidatesLoading(false);
    }
  }, [api]);
  useEffect(() => {
    let active = true;
    void api.getPublicationSetup().then((next) => { if (active) applySetup(next); })
      .catch((value: unknown) => { if (active) onError(errorMessage(value)); });
    return () => { active = false; };
  }, [api, applySetup, onError]);
  useEffect(() => {
    if (!setup?.siteTarget) {
      setCandidates([]);
      setSelectedCandidateId("");
      setCandidateSearchComplete(false);
      return;
    }
    void refreshCandidates().catch((value: unknown) => onError(errorMessage(value)));
  }, [onError, refreshCandidates, setup?.siteTarget]);

  const run = async (work: () => Promise<PublicationSetup>, message: string): Promise<void> => {
    setBusy(true);
    try { applySetup(await work()); onNotice(message); }
    catch (value) { onError(errorMessage(value)); try { await refresh(); } catch { /* preserve operation error */ } }
    finally { setBusy(false); }
  };

  const workflow = setup?.activeWorkflow;
  const targetLocked = Boolean(workflow);
  const socialLocked = Boolean(workflow?.linkedInApproval);
  const linkedInState = connectingLinkedIn ? "connecting" : (setup?.linkedInState.state ?? "disconnected");
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId);
  const reviewCandidate = workflow
    ? candidates.find((candidate) => workflow.bundle.artifacts.some((artifact) =>
      artifact.role === "primary-article"
      && (artifact.path === candidate.articles.tr.path || artifact.path === candidate.articles.en.path)))
    : selectedCandidate;

  const connectLinkedIn = async (): Promise<void> => {
    setConnectingLinkedIn(true);
    try { await run(() => api.connectLinkedIn(), t('publication.connectedNotice')); }
    finally { setConnectingLinkedIn(false); }
  };

  return <div className="publication-stack">
    <section className="panel form settings publication-setup" aria-labelledby="publication-setup-title">
      <div><p className="eyebrow">{t('publication.eyebrow')}</p><h2 id="publication-setup-title">{t('publication.configureTarget')}</h2><p>{t('publication.targetHelp')}</p></div>
      <div className="publication-grid">
        <label><span>{t('publication.websiteDomain')}</span><input disabled={targetLocked} value={displayDomain} placeholder="example.com" onChange={(event) => setDisplayDomain(event.target.value)} /></label>
        <label><span>{t('publication.siteWorkspace')}</span><select disabled={targetLocked} value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">{t('publication.chooseWorkspace')}</option>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.id}</option>)}</select></label>
        <label><span>{t('publication.articleFolder')}</span><input disabled={targetLocked} value={contentDirectory} placeholder="src/content/writing" onChange={(event) => setContentDirectory(event.target.value)} /></label>
        <label><span>{t('publication.publicBaseUrl')}</span><input disabled={targetLocked} value={publicBaseUrl} placeholder="https://example.com/writing" onChange={(event) => setPublicBaseUrl(event.target.value)} /></label>
        <label><span>{t('publication.productionBranch')}</span><input disabled={targetLocked} value={publishBranch} placeholder="main" onChange={(event) => setPublishBranch(event.target.value)} /></label>
        <label><span>{t('publication.assetFolders')}</span><textarea disabled={targetLocked} value={approvedAssetDirectories} placeholder={"public/assets/writing\npublic/images/blog"} onChange={(event) => setApprovedAssetDirectories(event.target.value)} /><small>{t('publication.assetFoldersHelp')}</small></label>
      </div>
      <div className="actions">
        {setup?.siteTarget ? <button type="button" disabled={busy || targetLocked} onClick={() => void run(() => api.clearPublicationSiteTarget(), t('publication.targetRemoved'))}>{t('publication.removeTarget')}</button> : null}
        <button className="primary" type="button" disabled={busy || targetLocked || !displayDomain || !workspaceId || !contentDirectory || !publishBranch} onClick={() => void run(() => api.savePublicationSiteTarget({ displayDomain, workspaceId, contentDirectory, publishBranch, ...(lines(approvedAssetDirectories).length ? { approvedAssetDirectories: lines(approvedAssetDirectories) } : {}), ...(publicBaseUrl.trim() ? { publicBaseUrl } : {}) }), t('publication.targetSaved'))}>{t('publication.saveTarget')}</button>
      </div>
      <div className="publication-connection">
        <div><strong>{t('publication.linkedinTitle')}</strong><small>{t('publication.connection')}: <b data-testid="linkedin-connection-state">{connectionStateLabel(linkedInState, t)}</b>{setup?.linkedInState.member?.displayName ? ` — ${setup.linkedInState.member.displayName}` : ""}. {t('publication.linkedinSecurity')}</small></div>
        <label><span>{t('publication.clientId')}</span><input disabled={socialLocked} value={linkedInClientId} placeholder={t('publication.publicClientId')} onChange={(event) => setLinkedInClientId(event.target.value)} /></label>
        <label><span>{t('publication.apiVersion')}</span><input disabled={socialLocked} value={linkedInApiVersion} placeholder="202608" inputMode="numeric" onChange={(event) => setLinkedInApiVersion(event.target.value)} /><small>{t('publication.apiVersionHelp')}</small></label>
        {setup?.linkedInState.error ? <div className="privacy-callout"><strong>{t('publication.connectionError')}</strong><span>{setup.linkedInState.error}</span></div> : null}
        <div className="actions">
          <button type="button" disabled={busy || socialLocked || !linkedInClientId || !/^\d{6}$/u.test(linkedInApiVersion)} onClick={() => void run(() => api.saveLinkedInPublisherConfiguration({ clientId: linkedInClientId, apiVersion: linkedInApiVersion }), t('publication.setupSavedNotice'))}>{t('publication.saveSetup')}</button>
          <button className="primary" type="button" disabled={busy || socialLocked || !setup?.linkedInConfiguration || linkedInState === "connecting"} onClick={() => void connectLinkedIn()}>{t('publication.connect')}</button>
          {setup?.linkedInState.state !== "disconnected" ? <button type="button" disabled={busy} onClick={() => void run(() => api.disconnectLinkedIn(), t('publication.disconnectedNotice'))}>{t('publication.disconnect')}</button> : null}
        </div>
      </div>
    </section>

    {!workflow ? <section className="panel form settings publication-setup" aria-labelledby="publication-package-title">
      <div><p className="eyebrow">{t('publication.outputEyebrow')}</p><h2 id="publication-package-title">{t('publication.useApproved')}</h2><p>{t('publication.useApprovedHelp')}</p></div>
      {!setup?.siteTarget ? <div className="privacy-callout"><strong>{t('publication.saveTargetFirst')}</strong><span>{t('publication.saveTargetFirstHelp')}</span></div> : null}
      {candidates.length ? <div className="publication-candidate-list" role="radiogroup" aria-label={t('publication.approvedPublications')}>
        {candidates.map((candidate) => <label className={candidate.id === selectedCandidateId ? "selected" : ""} key={candidate.id}>
          <input type="radio" name="publication-candidate" value={candidate.id} checked={candidate.id === selectedCandidateId} onChange={() => { setSelectedCandidateId(candidate.id); setPrimaryLanguage(candidate.recommendedPrimaryLanguage); }} />
          <span><strong>{candidate.label}</strong><small>{candidate.sessionName} · {new Date(candidate.updatedAt).toLocaleString(locale)}</small></span>
        </label>)}
      </div> : null}
      {selectedCandidate ? <CandidatePreview candidate={selectedCandidate} primaryLanguage={primaryLanguage} onPrimaryLanguage={setPrimaryLanguage} /> : null}
      {candidateSearchComplete && !candidates.length ? <div className="privacy-callout"><strong>{t('publication.noneFound')}</strong><span>{t('publication.noneFoundHelp')}</span></div> : null}
      <div className="actions">
        {selectedCandidate ? <button className="primary" type="button" disabled={busy || candidatesLoading} onClick={() => void run(() => api.startPublicationCandidate(selectedCandidate.id, primaryLanguage), t('publication.assembledNotice'))}>{t('publication.review')}</button>
          : <button className="primary" type="button" disabled={busy || candidatesLoading || !setup?.siteTarget} onClick={() => void refreshCandidates().catch((value: unknown) => onError(errorMessage(value)))}>{candidatesLoading ? t('publication.finding') : t('publication.useApproved')}</button>}
      </div>
      <details className="settings-details publication-manual-details">
        <summary>{t('publication.advanced')}</summary>
        <div className="publication-grid">
          <label><span>{t('publication.packageId')}</span><input value={contentId} onChange={(event) => setContentId(event.target.value)} /></label>
          <label><span>{t('publication.primaryPath')}</span><input value={primaryArticlePath} placeholder="src/content/writing/article.md" onChange={(event) => setPrimaryArticlePath(event.target.value)} /></label>
          <label><span>{t('publication.translationPaths')}</span><textarea value={translationPaths} placeholder="src/content/writing/article.tr.md" onChange={(event) => setTranslationPaths(event.target.value)} /><small>{t('publication.translationHelp')}</small></label>
          <label><span>{t('publication.visualPaths')}</span><textarea value={visualAssetPaths} placeholder="public/images/article/hero.webp" onChange={(event) => setVisualAssetPaths(event.target.value)} /><small>{t('publication.optionalPathHelp')}</small></label>
          <label><span>{t('publication.otherPaths')}</span><textarea value={otherAssetPaths} onChange={(event) => setOtherAssetPaths(event.target.value)} /><small>{t('publication.optionalPathHelp')}</small></label>
        </div>
        <div className="actions"><button type="button" disabled={busy || !setup?.siteTarget || !contentId.trim() || !primaryArticlePath.trim() || lines(translationPaths).length === 0} onClick={() => void run(() => api.startPublication({ contentId, primaryArticlePath, translationPaths: lines(translationPaths), ...(lines(visualAssetPaths).length ? { visualAssetPaths: lines(visualAssetPaths) } : {}), ...(lines(otherAssetPaths).length ? { otherAssetPaths: lines(otherAssetPaths) } : {}) }), t('publication.manualNotice'))}>{t('publication.createManual')}</button></div>
      </details>
    </section> : <section className="panel publication-review" aria-labelledby="publication-review-title">
      <div><p className="eyebrow">{t('publication.exactReview')}</p><h2 id="publication-review-title">{workflow.contentId}</h2><p>{t('common.status')}: <strong>{stageLabel(workflow.stage, t)}</strong></p></div>
      {reviewCandidate ? <CandidatePreview candidate={reviewCandidate} primaryLanguage={workflow.bundle.primaryArticlePath === reviewCandidate.articles.tr.path ? "tr" : "en"} /> : <div className="privacy-callout"><strong>{t('publication.previewUnavailable')}</strong><span>{t('publication.previewUnavailableHelp')}</span></div>}
      <details className="settings-details publication-integrity-details">
        <summary>{t('publication.integrity')}</summary>
        <div className="publication-bundle" role="list" aria-label={t('publication.exactBundle')}>{workflow.bundle.artifacts.map((artifact) => <div role="listitem" className="publication-artifact" key={artifact.path}><span><strong>{artifactRoleLabel(artifact.role, t)}</strong>{artifact.path}</span><code>{artifact.sha256}</code></div>)}</div>
      </details>
      <div className="actions publication-actions">
        {workflow.stage === "SITE_APPROVAL_PENDING" ? <button className="primary" type="button" disabled={busy} onClick={() => void run(() => api.approveSitePublication(), t('publication.siteApprovedNotice'))}>{t('publication.approveSite')}</button> : null}
        {workflow.stage === "SITE_APPROVED" ? <button className="primary" type="button" disabled={busy} onClick={() => void run(() => api.publishSite(), t('publication.sitePublishedNotice'))}>{t('publication.publishSite')}</button> : null}
        {workflow.stage === "SITE_PUBLICATION_AWAITING_VERIFICATION" ? <button className="primary" type="button" disabled={busy} onClick={() => void run(() => api.retrySiteVerification(), t('publication.siteVerifiedNotice'))}>{t('publication.checkSite')}</button> : null}
        {workflow.stage === "SITE_PUBLISHED_VERIFIED" ? <button type="button" disabled={busy || setup?.linkedInState.state !== "connected" || !linkedInCommentary.trim()} onClick={() => void run(() => api.requestLinkedInApproval(linkedInCommentary), t('publication.linkedinApprovalRequestedNotice'))}>{t('publication.requestLinkedinApproval')}</button> : null}
        {workflow.stage === "LINKEDIN_APPROVAL_PENDING" ? <button type="button" disabled={busy} onClick={() => void run(() => api.approveLinkedIn(), t('publication.linkedinApprovedNotice'))}>{t('publication.approveLinkedin')}</button> : null}
        {workflow.stage === "LINKEDIN_APPROVED" ? <button className="primary" type="button" disabled={busy || setup?.linkedInState.state !== "connected"} onClick={() => void run(() => api.shareLinkedIn(), t('publication.linkedinPublishedNotice'))}>{t('publication.publishLinkedin')}</button> : null}
        {workflow.stage === "LINKEDIN_SHARE_AWAITING_VERIFICATION" ? <button className="primary" type="button" disabled={busy || setup?.linkedInState.state !== "connected"} onClick={() => void run(() => api.retryLinkedInVerification(), t('publication.linkedinVerifiedNotice'))}>{t('publication.checkLinkedin')}</button> : null}
        {(workflow.stage === "SITE_PUBLISHED_VERIFIED" || workflow.stage === "LINKEDIN_SHARED_VERIFIED") ? <button type="button" disabled={busy} onClick={() => void run(() => api.archivePublication(), t('publication.archivedNotice'))}>{t('publication.archive')}</button> : null}
      </div>
      {workflow.publicationUrl ? <div className="verified-publication"><strong>{t('publication.verifiedUrl')}</strong><button type="button" className="link-button" onClick={() => void api.openExternalLink(workflow.publicationUrl ?? "")}>{workflow.publicationUrl}</button></div> : null}
      {workflow.stage === "SITE_PUBLISHED_VERIFIED" ? <label><span>{t('publication.commentary')}</span><textarea data-testid="linkedin-commentary" maxLength={3000} value={linkedInCommentary} onChange={(event) => setLinkedInCommentary(event.target.value)} /><small>{t('publication.commentaryHelp')}</small></label> : null}
      {workflow.linkedInApproval ? <div className="privacy-callout" data-testid="linkedin-approval-copy"><strong>{workflow.linkedInApproval.approvedAt ? t('publication.approvedLinkedin') : t('publication.pendingLinkedin')}</strong><span>{workflow.linkedInApproval.commentary}</span><span>{workflow.linkedInApproval.publicationUrl}</span><span>{workflow.linkedInApproval.memberDisplayName ?? workflow.linkedInApproval.authorUrn}</span></div> : null}
    </section>}

    {setup?.history.length ? <section className="panel publication-history"><div><p className="eyebrow">{t('publication.historyEyebrow')}</p><h2>{t('publication.historyTitle')}</h2></div>{setup.history.map((item) => <div key={item.id}><strong>{item.contentId}</strong><span>{stageLabel(item.stage, t)}</span>{item.publicationUrl ? <span>{item.publicationUrl}</span> : null}</div>)}</section> : null}
  </div>;
}
