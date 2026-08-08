import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, isLanguage, translations } from '../src/i18n/config';
import { en } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assertEqual(DEFAULT_LANGUAGE, 'en');
assertEqual(LANGUAGE_STORAGE_KEY, 'openleaf-lang');
assertEqual(translations.en, en);
assertEqual(translations.zh, zh);

const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zh).sort();

assert(enKeys.length > 0, 'Expected English translations to contain keys');
assertEqual(JSON.stringify(zhKeys), JSON.stringify(enKeys), 'Expected Chinese translations to mirror English keys');

const emptyEn = enKeys.filter((key) => !en[key as keyof typeof en].trim());
const emptyZh = zhKeys.filter((key) => !zh[key as keyof typeof zh].trim());
assertEqual(emptyEn.length, 0, `Expected no empty English strings, found: ${emptyEn.join(', ')}`);
assertEqual(emptyZh.length, 0, `Expected no empty Chinese strings, found: ${emptyZh.join(', ')}`);

assert(isLanguage('en') && isLanguage('zh'), 'Expected en/zh to be recognised languages');
assert(!isLanguage('fr') && !isLanguage(null), 'Expected unknown values to be rejected');

console.log('i18n tests passed');
