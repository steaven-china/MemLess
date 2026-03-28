export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type TranslationParams = Record<string, string | number | boolean | null | undefined>;

export type MessageDictionary = Record<string, string>;
