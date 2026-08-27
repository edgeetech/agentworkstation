import type { NetworkGateway } from '@application/ports/NetworkGateway';

export type OllamaModel = {
  id: string;
  size: number;
  modifiedAt?: string;
  capabilities: string[];
  toolCalling: boolean;
  location: 'local' | 'cloud';
};

export const isOllamaCloudModel = (modelId: string): boolean => /(?:-cloud(?::|$)|:cloud$)/i.test(modelId);

type OllamaTagsResponse = {
  models?: Array<{ name?: unknown; size?: unknown; modified_at?: unknown }>;
};

export async function inspectOllamaModel(
  baseUrl: string,
  modelId: string,
  gateway: NetworkGateway,
  signal: AbortSignal,
): Promise<{ capabilities: string[]; toolCalling: boolean }> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const response = await gateway.send({
    url: `${normalizedBaseUrl}/api/show`,
    method: 'POST',
    headers: { Accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelId }),
    purpose: 'ollama-model-capability-discovery',
    executionMode: 'local_only',
  }, signal);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ollama model inspection failed with status ${response.status}`);
  }
  const payload = JSON.parse(response.body) as { capabilities?: unknown };
  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.filter((value): value is string => typeof value === 'string')
    : [];
  return { capabilities, toolCalling: capabilities.includes('tools') };
}

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

  const models = (payload.models ?? [])
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
  return Promise.all(models.map(async (model) => ({
    ...model,
    location: isOllamaCloudModel(model.id) ? 'cloud' as const : 'local' as const,
    ...(await inspectOllamaModel(baseUrl, model.id, gateway, signal)),
  })));
}
