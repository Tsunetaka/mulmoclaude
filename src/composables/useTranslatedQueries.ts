// Translates a role's suggested queries into the user's current browser locale.
// A thin wrapper over the generic `useTranslatedStrings` (namespace
// "role-queries"); all caching / de-dup / fallback logic lives there and in the
// host-agnostic `@mulmoclaude/core/translation/client` cache it wraps.
//
// `locale` is taken as a Ref instead of being read from `useI18n()` internally
// so the composable can be unit-tested outside a Vue setup context.

import { computed, type ComputedRef, type Ref } from "vue";
import { useTranslatedStrings, __resetTranslatedStringsCacheForTests } from "./useTranslatedStrings";
import type { Role } from "../config/roles";

const TRANSLATION_NAMESPACE = "role-queries";

export interface UseTranslatedQueriesResult {
  /** Translated queries when available, falling back to the role's English
   *  source while the request is in flight or fails. */
  readonly queries: ComputedRef<string[]>;
}

export function useTranslatedQueries(role: Ref<Role | undefined>, locale: Ref<string>): UseTranslatedQueriesResult {
  const sentences = computed<readonly string[]>(() => role.value?.queries ?? []);
  const queries = useTranslatedStrings(TRANSLATION_NAMESPACE, sentences, locale);
  return { queries };
}

// Re-exported under the historical name so existing tests keep resetting the
// (now shared) translation cache between cases.
export const __resetTranslatedQueriesCacheForTests = __resetTranslatedStringsCacheForTests;
