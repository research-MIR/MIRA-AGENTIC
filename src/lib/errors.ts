// A map of keywords to their corresponding translation keys in i18n.ts
const errorKeywordMap: Record<string, string> = {
    "quota exceeded": "errorQuotaExceeded",
    "safety filters": "errorSafetyFilters",
    "could not decide on a next step": "errorAgentStuck",
    "no image found in history": "errorNoImageToRefine",
    "ERROR_NO_IMAGE_TO_REFINE": "errorNoImageToRefine",
    "failed to fetch": "errorNetwork",
    "network request failed": "errorNetwork",
    "maximum context memory": "errorMaxContext",
    "history is too long": "errorMaxContext",
};

/**
 * Translates a raw technical error message into a user-friendly, localized string.
 * @param rawError The technical error message from the backend or a network request.
 * @param t The translation function from the i18n context.
 * @returns A user-friendly, translated error message.
 */
export const translateErrorMessage = (rawError: string | null | undefined, t: (key: string) => string): string => {
    if (!rawError) {
        return t('errorUnknown');
    }

    const lowerCaseError = rawError.toLowerCase();

    for (const keyword in errorKeywordMap) {
        if (lowerCaseError.includes(keyword)) {
            const translationKey = errorKeywordMap[keyword];
            return t(translationKey);
        }
    }

    // If no keyword matches, return a generic error but include the raw message for debugging.
    console.error("Untranslated error:", rawError);
    return `${t('errorUnknown')}. Details: ${rawError}`;
};