import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import translationEn from './en/translation.json';
import translationZhHans from './zh-Hans/translation.json';

export const defaultNS = 'translation';

export const resources = {
  en: { translation: translationEn },
  'zh-Hans': { translation: translationZhHans },
} as const;

function normalizeLanguage(language: string): string {
  const normalized = language.replaceAll('_', '-').toLowerCase();
  if (
    normalized === 'zh' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh-hans' ||
    normalized.startsWith('zh-hans-')
  ) {
    return 'zh-Hans';
  }
  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en';
  }
  return language;
}

i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: {
      default: ['en'],
    },
    fallbackNS: 'translation',
    ns: ['translation'],
    debug: false,
    defaultNS,
    resources,
    supportedLngs: ['en', 'zh-Hans'],
    detection: {
      convertDetectedLanguage: normalizeLanguage,
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
