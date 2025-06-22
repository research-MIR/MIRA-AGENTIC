import { translations as allTranslations } from './translations';

// This is a temporary workaround to avoid a circular dependency issue
// where the main i18n file is imported by a translation file.
// By re-exporting, we keep the structure but break the cycle.
export const translations = allTranslations;