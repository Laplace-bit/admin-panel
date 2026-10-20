import type * as t from '@/types';
import { TERMS_NOT_ACCEPTED_CODE } from '@/constants';

const TERMS_PREFIX = `${TERMS_NOT_ACCEPTED_CODE} `;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/**
 * Where to accept LibreChat's terms of service when an admin API call was
 * refused until the admin does (`''` when LibreChat's address isn't known);
 * `null` for any other failure.
 */
export function termsRefusalUrl(error: unknown): string | null {
  const message = messageOf(error);
  if (message === TERMS_NOT_ACCEPTED_CODE) return '';
  return message.startsWith(TERMS_PREFIX) ? message.slice(TERMS_PREFIX.length).trim() : null;
}

/**
 * A failed admin action as the page states it: LibreChat's terms refusal
 * explained (with where to accept them), else the error's own text, else
 * `fallback`.
 */
export function errorText(error: unknown, fallback: string, localize: t.LocalizeFn): string {
  const termsUrl = termsRefusalUrl(error);
  if (termsUrl) return localize('com_config_terms_refused_at', { url: termsUrl });
  if (termsUrl === '') return localize('com_config_terms_refused');
  return messageOf(error) || fallback;
}
