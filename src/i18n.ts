type Catalog = { locale: string; messages: Record<string, string> };
const catalogs = import.meta.glob<Catalog>("./locales/*.json", {
  eager: true,
  import: "default",
});
let language = "en",
  messages: Record<string, string> = {};
export function setLanguage(
  locale = "en",
  translations?: Record<string, string>,
) {
  language = locale;
  const base = catalogs["./locales/en.json"]?.messages || {};
  messages = {
    ...base,
    ...(catalogs[`./locales/${locale}.json`]?.messages || {}),
    ...translations,
  };
  document.documentElement.lang = locale;
}
export function t(
  key: string,
  values: Record<string, string | number> = {},
): string {
  let result = messages[key] || key;
  for (const [name, value] of Object.entries(values))
    result = result.replaceAll(`{${name}}`, String(value));
  return result;
}
export function phrases() {
  return messages;
}
export function currentLanguage() {
  return language;
}
