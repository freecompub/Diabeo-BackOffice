import { vi } from "vitest"

export const useTranslations = vi.fn((namespace?: string) => {
  return (key: string, values?: Record<string, unknown>) => {
    const fullKey = namespace ? `${namespace}.${key}` : key
    if (values) {
      return Object.entries(values).reduce(
        (str, [k, v]) => str.replace(`{${k}}`, String(v)),
        fullKey
      )
    }
    return fullKey
  }
})

export const useLocale = vi.fn(() => "fr")

export const NextIntlClientProvider = ({ children }: { children: React.ReactNode }) => children
