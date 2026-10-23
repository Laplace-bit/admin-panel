import { EModelEndpoint } from 'librechat-data-provider';

/** Built-in providers, in the order the AI providers tab lists them. */
export const BUILT_IN_PROVIDERS: readonly string[] = [
  EModelEndpoint.openAI,
  EModelEndpoint.google,
  EModelEndpoint.anthropic,
  EModelEndpoint.azureOpenAI,
  EModelEndpoint.azureAssistants,
  EModelEndpoint.assistants,
  EModelEndpoint.agents,
  EModelEndpoint.bedrock,
];

/** The key of the block whose settings apply to every endpoint (D11). */
export const GLOBAL_PROVIDER_KEY = 'all';

/**
 * Where each built-in provider's credentials come from (LibreChat's
 * `EndpointService`): a locale key naming the environment variables, shown in
 * the provider's status row and badge tooltip.
 */
export const PROVIDER_CREDENTIALS_KEYS: Readonly<Record<string, string>> = {
  [EModelEndpoint.openAI]: 'com_config_providers_creds_openAI',
  [EModelEndpoint.google]: 'com_config_providers_creds_google',
  [EModelEndpoint.anthropic]: 'com_config_providers_creds_anthropic',
  [EModelEndpoint.azureOpenAI]: 'com_config_providers_creds_azureOpenAI',
  [EModelEndpoint.azureAssistants]: 'com_config_providers_creds_azureAssistants',
  [EModelEndpoint.assistants]: 'com_config_providers_creds_assistants',
  [EModelEndpoint.agents]: 'com_config_providers_creds_agents',
  [EModelEndpoint.bedrock]: 'com_config_providers_creds_bedrock',
};
