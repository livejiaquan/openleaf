import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type TranslationKey } from '../i18n/en';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isLanguage,
  translations,
  type Language,
} from '../i18n/config';

export type { Language, TranslationKey };
export { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, translations };

interface TranslationValues {
  [key: string]: string | number;
}

interface LanguageContextValue {
  lang: Language;
  setLang: (language: Language) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
}

function readStoredLanguage(): Language {
  try {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(storedLanguage) ? storedLanguage : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(() => readStoredLanguage());

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // Ignore storage failures so the UI can still switch languages in memory.
    }
  }, [lang]);

  const t = useCallback((key: TranslationKey, values?: TranslationValues) => (
    interpolate(translations[lang][key] ?? translations[DEFAULT_LANGUAGE][key], values)
  ), [lang]);

  const value = useMemo<LanguageContextValue>(() => ({
    lang,
    setLang,
    t,
  }), [lang, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used inside LanguageProvider');
  }
  return context;
}
