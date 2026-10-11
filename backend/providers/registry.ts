/**
 * AI Provider Registry
 *
 * Centralized resolution and orchestration for LLM providers.
 *
 * STRICT FAILOVER POLICY:
 * Does NOT silently switch providers when one fails or is unconfigured.
 * An unconfigured or failing provider immediately returns a clear ProviderError.
 */

import type { ProviderId } from '../../lib/types.ts';
import { ProviderError } from './errors.ts';
import type { ILlmProviderAdapter } from './types.ts';
import { GeminiProvider } from './gemini-provider.ts';
import { OpenRouterProvider } from './openrouter.ts';
import { NvidiaProvider } from './nvidia.ts';
import { MockProvider } from './mock-provider.ts';

export class ProviderRegistry {
  private providers: Map<ProviderId, ILlmProviderAdapter> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.providers.set('gemini', new GeminiProvider());
    this.providers.set('openrouter', new OpenRouterProvider());
    this.providers.set('nvidia', new NvidiaProvider());
    this.providers.set('mock', new MockProvider());
  }

  /**
   * Registers or overrides a provider adapter instance. Useful for tests and dependency injection.
   */
  registerProvider(provider: ILlmProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Resets registry to default provider adapters.
   */
  resetToDefaults(): void {
    this.providers.clear();
    this.registerDefaults();
  }

  /**
   * Resolves a provider by ID.
   * Enforces strict error throwing without silent fallback.
   */
  getProvider(id: ProviderId): ILlmProviderAdapter {
    const provider = this.providers.get(id);

    if (!provider) {
      const supported = Array.from(this.providers.keys()).join(', ');
      throw new ProviderError({
        providerId: id,
        code: 'INVALID_REQUEST',
        message: `Provider '${id}' is not supported. Available providers: [${supported}].`,
      });
    }

    if (!provider.isConfigured()) {
      throw new ProviderError({
        providerId: id,
        code: 'CONFIGURATION_ERROR',
        message: `Provider '${id}' is not configured. Missing required API key or server credentials.`,
      });
    }

    return provider;
  }

  /**
   * Returns default provider configured via DEFAULT_LLM_PROVIDER env variable or 'gemini'.
   */
  getDefaultProvider(): ILlmProviderAdapter {
    const envDefault = (process.env.DEFAULT_LLM_PROVIDER as ProviderId) || 'gemini';
    return this.getProvider(envDefault);
  }

  /**
   * Returns list of all registered provider IDs.
   */
  listSupportedProviders(): ProviderId[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Returns list of provider IDs that have valid environment credentials configured.
   */
  listConfiguredProviders(): ProviderId[] {
    const configured: ProviderId[] = [];
    for (const [id, provider] of this.providers.entries()) {
      if (provider.isConfigured()) {
        configured.push(id);
      }
    }
    return configured;
  }
}

export const providerRegistry = new ProviderRegistry();

/**
 * Convenient helper to retrieve a provider from the singleton registry.
 */
export function getLlmProvider(id?: ProviderId): ILlmProviderAdapter {
  if (id) {
    return providerRegistry.getProvider(id);
  }
  return providerRegistry.getDefaultProvider();
}
