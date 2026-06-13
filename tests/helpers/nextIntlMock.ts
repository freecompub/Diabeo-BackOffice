/**
 * Mock `next-intl` pour les tests de composants (jsdom).
 *
 * Pourquoi un mock plutôt qu'un `NextIntlClientProvider` : sous Vitest, le
 * contexte du provider n'est pas partagé de façon fiable (instances de module
 * distinctes) — `useTranslations` renverrait la clé brute. Le repo mocke donc
 * `next-intl` (cf. `tests/unit/acronyms.test.tsx`).
 *
 * Ce mock résout les VRAIS libellés FR depuis `messages/fr.json` (par
 * namespace + clé, namespaces imbriqués via `.`) et interpole les paramètres
 * ICU simples `{param}`. Ainsi les assertions de texte FR restent valides et
 * une clé manquante échoue le test (couverture anti-régression).
 *
 * Usage dans un fichier de test :
 *   vi.mock("next-intl", async () =>
 *     (await import("../helpers/nextIntlMock")).makeNextIntlMock())
 */

import frMessages from "../../messages/fr.json"

type Dict = Record<string, unknown>

function resolve(namespace: string, key: string): unknown {
  const path = namespace ? `${namespace}.${key}` : key
  return path
    .split(".")
    .reduce<unknown>((acc, seg) => (acc as Dict | undefined)?.[seg], frMessages)
}

function interpolate(value: string, params?: Record<string, unknown>): string {
  if (!params) return value
  return value.replace(/\{(\w+)\}/g, (_, name) =>
    name in params ? String(params[name]) : `{${name}}`,
  )
}

export function makeNextIntlMock() {
  const useTranslations = (namespace = "") => {
    const t = (key: string, params?: Record<string, unknown>) => {
      const raw = resolve(namespace, key)
      if (typeof raw !== "string") return namespace ? `${namespace}.${key}` : key
      return interpolate(raw, params)
    }
    // t.rich : version simplifiée — concatène le texte des chunks.
    t.rich = (key: string, tags?: Record<string, (chunks?: unknown) => unknown>) => {
      const raw = resolve(namespace, key)
      if (typeof raw !== "string") return namespace ? `${namespace}.${key}` : key
      // Retire les balises <tag>…</tag> en gardant le contenu textuel.
      return raw.replace(/<(\w+)>(.*?)<\/\1>/g, "$2").replace(/<(\w+)\s*\/>/g, "")
    }
    return t
  }
  return {
    useTranslations,
    useLocale: () => "fr",
    useFormatter: () => ({}),
    NextIntlClientProvider: ({ children }: { children: unknown }) => children,
  }
}
