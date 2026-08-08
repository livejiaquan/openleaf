import { en, type TranslationKey } from './en';
import { zh } from './zh';

export type Language = 'en' | 'zh';

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'openleaf-lang';
export const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  zh,
};

export function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'zh';
}
