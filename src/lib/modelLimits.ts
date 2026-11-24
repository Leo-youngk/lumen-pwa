import type { ModelOption } from './api'

export type OutputLimitSetting = number | 'max' | 'auto'

const PRESET_STEPS = [1024, 4096, 8192, 16384, 32768, 65536, 131072]

/**
 * Resolve the `max_tokens` we actually send.
 *
 * - `'max'`   → the ceiling the provider declares for this model
 * - `number`  → the chosen value, clamped to that ceiling
 * - `'auto'`  → the ceiling when known; otherwise 20% of the context window
 *
 * The last branch matters: a 200K-context model used to inherit the app-wide
 * 130K default, so a single reply could ask for more than the window allows
 * once history was added. Providers that report nothing get a conservative
 * share instead of a number borrowed from a different model.
 */
export function resolveOutputLimit(model: ModelOption | undefined, setting: OutputLimitSetting): number | undefined {
  const ceiling = model?.outputTokens
  if (setting === 'max') return ceiling
  if (typeof setting === 'number') return ceiling ? Math.min(setting, ceiling) : setting
  if (ceiling) return ceiling
  if (model?.contextTokens) return Math.max(1024, Math.min(65_536, Math.floor(model.contextTokens * 0.2)))
  return undefined
}

/** Steps that make sense for this model; the model's own ceiling is appended. */
export function outputPresetsFor(model: ModelOption | undefined): number[] {
  const ceiling = model?.outputTokens
  if (!ceiling) return PRESET_STEPS
  const within = PRESET_STEPS.filter((step) => step < ceiling)
  return within.includes(ceiling) ? within : [...within, ceiling]
}

/** True when the provider told us nothing about this model's limits. */
export function limitsUnknown(model: ModelOption | undefined): boolean {
  return !model?.outputTokens && !model?.contextTokens
}
