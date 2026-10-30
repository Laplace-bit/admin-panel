import type * as t from '@/types';

/**
 * Starting points for a new custom endpoint (WS10 CE-10). China-market providers
 * come first. Each starts with per-user credentials and a short, editable model
 * list so adding a provider does not publish its entire catalog to users. Model
 * IDs change often; verify them against the provider's current console and API
 * documentation.
 */
export const ENDPOINT_TEMPLATES: readonly t.EndpointTemplate[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    descriptionKey: 'com_config_ce_template_deepseek',
    group: 'china',
    entry: {
      name: 'DeepSeek',
      apiKey: 'user_provided',
      baseURL: 'https://api.deepseek.com',
      models: { default: ['deepseek-flash'], fetch: false },
      titleConvo: true,
      titleModel: 'deepseek-flash',
      modelDisplayLabel: 'DeepSeek',
    },
  },
  {
    id: 'qwen',
    name: 'Qwen',
    descriptionKey: 'com_config_ce_template_qwen',
    group: 'china',
    entry: {
      name: 'Qwen',
      apiKey: 'user_provided',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: { default: ['qwen3.7-plus', 'qwen3.8-max'], fetch: false },
      titleConvo: true,
      titleModel: 'qwen3.7-plus',
      modelDisplayLabel: 'Qwen',
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    descriptionKey: 'com_config_ce_template_kimi',
    group: 'china',
    entry: {
      name: 'Kimi',
      apiKey: 'user_provided',
      baseURL: 'https://api.moonshot.cn/v1',
      models: { default: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'], fetch: false },
      titleConvo: true,
      titleModel: 'kimi-k3.1-pro',
      modelDisplayLabel: 'Kimi',
    },
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    descriptionKey: 'com_config_ce_template_glm',
    group: 'china',
    entry: {
      name: '智谱 GLM',
      apiKey: 'user_provided',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
      models: { default: ['glm-5.3', 'glm-5.3-flash'], fetch: false },
      titleConvo: true,
      titleModel: 'glm-5.3-flash',
      modelDisplayLabel: '智谱 GLM',
    },
  },
  {
    id: 'doubao',
    name: '火山方舟（豆包）',
    descriptionKey: 'com_config_ce_template_doubao',
    group: 'china',
    entry: {
      name: '火山方舟',
      apiKey: 'user_provided',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      models: { default: ['doubao-seed-2-1-pro-260628'], fetch: false },
      titleConvo: true,
      titleModel: 'doubao-seed-2-1-pro-260628',
      modelDisplayLabel: '豆包',
    },
  },
  {
    id: 'qianfan',
    name: '百度千帆',
    descriptionKey: 'com_config_ce_template_qianfan',
    group: 'china',
    entry: {
      name: '百度千帆',
      apiKey: 'user_provided',
      baseURL: 'https://qianfan.baidubce.com/v2',
      models: { default: ['ernie-5.0'], fetch: false },
      titleConvo: true,
      titleModel: 'ernie-5.0',
      modelDisplayLabel: '百度千帆',
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    descriptionKey: 'com_config_ce_template_openrouter',
    group: 'other',
    entry: {
      name: 'OpenRouter',
      apiKey: '${OPENROUTER_KEY}',
      baseURL: 'https://openrouter.ai/api/v1',
      models: { default: ['openai/gpt-4o-mini'], fetch: true },
      titleConvo: true,
      titleModel: 'openai/gpt-4o-mini',
      dropParams: ['stop'],
      modelDisplayLabel: 'OpenRouter',
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    descriptionKey: 'com_config_ce_template_groq',
    group: 'other',
    entry: {
      name: 'Groq',
      apiKey: '${GROQ_API_KEY}',
      baseURL: 'https://api.groq.com/openai/v1/',
      models: { default: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], fetch: true },
      titleConvo: true,
      titleModel: 'llama-3.1-8b-instant',
      modelDisplayLabel: 'Groq',
    },
  },
  {
    id: 'mistral',
    name: 'Mistral',
    descriptionKey: 'com_config_ce_template_mistral',
    group: 'other',
    entry: {
      name: 'Mistral',
      apiKey: '${MISTRAL_API_KEY}',
      baseURL: 'https://api.mistral.ai/v1',
      models: { default: ['mistral-large-latest', 'mistral-small-latest'], fetch: true },
      titleConvo: true,
      titleModel: 'mistral-small-latest',
      dropParams: ['stop', 'user', 'frequency_penalty', 'presence_penalty'],
      modelDisplayLabel: 'Mistral',
    },
  },
  {
    id: 'xai',
    name: 'xAI',
    descriptionKey: 'com_config_ce_template_xai',
    group: 'other',
    entry: {
      name: 'xAI',
      apiKey: '${XAI_API_KEY}',
      baseURL: 'https://api.x.ai/v1',
      models: { default: ['grok-3', 'grok-3-mini'], fetch: true },
      titleConvo: true,
      titleModel: 'grok-3-mini',
      modelDisplayLabel: 'Grok',
    },
  },
  {
    id: 'together',
    name: 'Together AI',
    descriptionKey: 'com_config_ce_template_together',
    group: 'other',
    entry: {
      name: 'Together AI',
      apiKey: '${TOGETHERAI_API_KEY}',
      baseURL: 'https://api.together.xyz/v1',
      models: { default: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], fetch: true },
      titleConvo: true,
      titleModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      modelDisplayLabel: 'Together AI',
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    descriptionKey: 'com_config_ce_template_perplexity',
    group: 'other',
    entry: {
      name: 'Perplexity',
      apiKey: '${PERPLEXITY_API_KEY}',
      baseURL: 'https://api.perplexity.ai/',
      models: { default: ['sonar', 'sonar-pro'], fetch: false },
      titleConvo: true,
      titleModel: 'sonar',
      dropParams: ['stop', 'frequency_penalty'],
      modelDisplayLabel: 'Perplexity',
    },
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    descriptionKey: 'com_config_ce_template_fireworks',
    group: 'other',
    entry: {
      name: 'Fireworks',
      apiKey: '${FIREWORKS_API_KEY}',
      baseURL: 'https://api.fireworks.ai/inference/v1',
      models: { default: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], fetch: true },
      titleConvo: true,
      titleModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      dropParams: ['user'],
      modelDisplayLabel: 'Fireworks',
    },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    descriptionKey: 'com_config_ce_template_ollama',
    group: 'other',
    entry: {
      name: 'Ollama',
      apiKey: 'ollama',
      baseURL: 'http://host.docker.internal:11434/v1/',
      models: { default: ['llama3.2'], fetch: true },
      titleConvo: true,
      titleModel: 'current_model',
      modelDisplayLabel: 'Ollama',
    },
  },
];

/** A blank OpenAI-compatible endpoint. */
export const BLANK_ENDPOINT_TEMPLATE: t.EndpointTemplate = {
  id: 'blank',
  name: '',
  descriptionKey: 'com_config_ce_template_blank',
  entry: {},
};

/**
 * Records of a custom endpoint whose inherited keys a target can remove one
 * by one (`keyedTombstones`): its request headers and added body parameters
 * (owner decision on removing inherited values: keys of record maps only).
 */
export const INHERITED_KEY_RECORDS: ReadonlySet<string> = new Set(['headers', 'addParams']);
