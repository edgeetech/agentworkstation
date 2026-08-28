import type { ChatMode, RoutingDecision } from '../../../shared/api';

export function PrivacyPanel({
  cloudPermitted,
  mode,
  route,
}: {
  cloudPermitted: boolean;
  mode: ChatMode;
  route?: RoutingDecision;
}): JSX.Element {
  return (
    <dl className="privacy-details">
      <div><dt>Intelligence preference</dt><dd>Auto</dd></div>
      <div><dt>Resolved intelligence</dt><dd>{route ? route.location === 'simulated' ? 'Simulated demo' : route.modelId : 'Not resolved yet'}</dd></div>
      <div><dt>Execution mode</dt><dd>{mode === 'autopilot' ? 'Autopilot' : 'Standard'}</dd></div>
      <div><dt>Policy</dt><dd>{cloudPermitted ? 'Cloud permitted' : 'Local Only'}</dd></div>
      <div><dt>Last endpoint</dt><dd>{route ? `${route.providerLabel} · ${route.location}` : 'No request in this session'}</dd></div>
      <div><dt>Telemetry</dt><dd>Not implemented</dd></div>
      <div><dt>Network ledger</dt><dd>Detailed request history unavailable</dd></div>
      <p>{cloudPermitted
        ? 'Allowed external intelligence may receive prompt context when selected by routing.'
        : 'Current policy does not permit cloud intelligence. This panel does not infer unobserved network activity.'}</p>
    </dl>
  );
}
