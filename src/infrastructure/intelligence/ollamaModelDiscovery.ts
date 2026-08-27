import type { NetworkGateway } from '@application/ports/NetworkGateway';

export type OllamaModel = {
  id: string;
  size: number;
  modifiedAt?: string;
};

type OllamaTagsResponse = {
  models?: Array<{ name?: unknown; size?: unknown; modified_at?: unknown }>;
};

export async function discoverOllamaModels(
  baseUrl: string,
  gateway: NetworkGateway,
  signal: AbortSignal,
): Promise<OllamaModel[]> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const response = await gateway.send(
    {
      url: `${normalizedBaseUrl}/api/tags`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      purpose: 'ollama-model-discovery',
      executionMode: 'local_only',
    },
    signal,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ollama model discovery failed with status ${response.status}`);
  }

  let payload: OllamaTagsResponse;
  try {
    payload = JSON.parse(response.body) as OllamaTagsResponse;
  } catch {
    throw new Error('Ollama returned invalid model-list JSON');
  }

  return (payload.models ?? [])
    .flatMap((model) =>
      typeof model.name === 'string' && model.name.trim()
        ? [{
            id: model.name.trim(),
            size: typeof model.size === 'number' && Number.isFinite(model.size) ? model.size : 0,
            ...(typeof model.modified_at === 'string' ? { modifiedAt: model.modified_at } : {}),
          }]
        : [],
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}
