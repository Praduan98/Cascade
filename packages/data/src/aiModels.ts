// AI model catalog (Phase 3). The DATA layer owns the concrete list (cost +
// display), exactly as PROVIDERS in seed.ts owns provider data; the AiModelInfo
// *type* lives in @cascade/core. Colours are drawn from the cobalt family — the
// design system's reserved accent for cell references and AI.

import type { AiModel, AiModelInfo } from '@cascade/core'

export const AI_MODELS: AiModelInfo[] = [
  { key: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', model: 'claude-haiku-4-5', glyph: 'AN', monoColor: '#6c9bff', credits: 1, providerCostUsd: 0.002, isDefault: true },
  { key: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', glyph: 'OA', monoColor: '#4f7de6', credits: 1, providerCostUsd: 0.0015 },
  { key: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google', model: 'gemini-2.0-flash', glyph: 'GE', monoColor: '#8ab0ff', credits: 1, providerCostUsd: 0.001 },
]

const BY_KEY = new Map(AI_MODELS.map((m) => [m.key, m] as const))

/** Resolve a stored AiModel to its catalog entry (undefined if retired). */
export function resolveAiModel(m: AiModel): AiModelInfo | undefined {
  return BY_KEY.get(m.model)
}

export function aiModelByKey(key: string): AiModelInfo | undefined {
  return BY_KEY.get(key)
}

export function defaultAiModel(): AiModel {
  const info = AI_MODELS.find((m) => m.isDefault) ?? AI_MODELS[0]!
  return { provider: info.provider, model: info.model }
}
