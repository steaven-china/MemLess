import { EN_US_MESSAGES } from "./messages.en-US.js";
import { ZH_CN_MESSAGES } from "./messages.zh-CN.js";
import {
  SUPPORTED_LOCALES,
  type Locale,
  type MessageDictionary,
  type TranslationParams
} from "./types.js";

const DEFAULT_LOCALE: Locale = "zh-CN";

const MESSAGE_TABLE: Record<Locale, MessageDictionary> = {
  "zh-CN": ZH_CN_MESSAGES,
  "en-US": EN_US_MESSAGES
};

export interface I18n {
  readonly locale: Locale;
  readonly fallbackLocale: Locale;
  readonly messages: MessageDictionary;
  t(key: string, params?: TranslationParams): string;
  raw(key: string): string | undefined;
}

export interface CreateI18nOptions {
  locale?: string;
  fallbackLocale?: Locale;
}

export function createI18n(options: CreateI18nOptions = {}): I18n {
  const locale = resolveLocale(options.locale);
  const fallbackLocale = options.fallbackLocale ?? DEFAULT_LOCALE;
  return {
    locale,
    fallbackLocale,
    messages: MESSAGE_TABLE[locale],
    t: (key, params) => translate(key, locale, fallbackLocale, params),
    raw: (key) => MESSAGE_TABLE[locale][key] ?? MESSAGE_TABLE[fallbackLocale][key]
  };
}

export function resolveLocale(input?: string, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (!input) return fallback;
  const normalized = normalizeLocale(input);
  const matched = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalized);
  return matched ?? fallback;
}

export function pickLocale(inputs: Array<string | undefined>, fallback: Locale = DEFAULT_LOCALE): Locale {
  for (const input of inputs) {
    if (!input) continue;
    const resolved = resolveLocale(input, fallback);
    if (resolved !== fallback || normalizeLocale(input) === fallback.toLowerCase()) {
      return resolved;
    }
  }
  return fallback;
}

export function extractLocaleFromAcceptLanguage(headerValue: string | null | undefined): string | undefined {
  if (!headerValue) return undefined;
  const token = headerValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (!token) return undefined;
  return token.split(";")[0]?.trim();
}

export function normalizeLocale(value: string): string {
  return value.trim().replace("_", "-").toLowerCase();
}

function translate(
  key: string,
  locale: Locale,
  fallbackLocale: Locale,
  params?: TranslationParams
): string {
  const template = MESSAGE_TABLE[locale][key] ?? MESSAGE_TABLE[fallbackLocale][key] ?? key;
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, token) => {
    const value = params[token];
    if (value === undefined || value === null) return "";
    return String(value);
  });
}
