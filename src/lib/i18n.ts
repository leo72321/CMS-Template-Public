import type { Site } from './schema';

// Central language vocabulary. Extend this registry and the site schema together when adding locales.
export const localeNames: Record<string, string> = {
  'zh-TW': '繁體中文', en: 'English', es: 'Español',
};
const dictionary = {
  'zh-TW': {
    home: '首頁', blog: '全部文章', newest: '最新文章', subjects: '依主題閱讀',
    browse: '瀏覽全部文章', empty: '內容準備中。', published: '發布', updated: '更新',
    page: '頁面', index: '文章索引', category: '文章分類', prev: '上一頁', next: '下一頁',
    related: '延伸閱讀', sample: '範例', tag: '文章標籤', author: '作者介紹',
    languagePrompt: '你的瀏覽器偏好使用 {language}，是否切換語言？',
    switch: '切換至 {language}', stay: '繼續使用目前語言',
    notFound: '這個頁面不在這裡。', notFoundDescription: '這個網址可能已經移動，請回首頁或文章索引繼續瀏覽。',
  },
  en: {
    home: 'Home', blog: 'All articles', newest: 'Latest articles', subjects: 'Browse topics',
    browse: 'Browse all articles', empty: 'Content is coming soon.', published: 'Published', updated: 'Updated',
    page: 'Page', index: 'Articles', category: 'Category', prev: 'Previous', next: 'Next',
    related: 'Related articles', sample: 'Example', tag: 'Tags', author: 'About the author',
    languagePrompt: 'Your browser prefers {language}. Would you like to switch?',
    switch: 'Switch to {language}', stay: 'Continue in this language',
    notFound: 'This page was not found.', notFoundDescription: 'This URL may have moved. Visit the home page or article index.',
  },
  es: {
    home: 'Inicio', blog: 'Todos los artículos', newest: 'Últimos artículos', subjects: 'Explorar temas',
    browse: 'Ver todos los artículos', empty: 'Próximamente habrá contenido.', published: 'Publicado', updated: 'Actualizado',
    page: 'Página', index: 'Artículos', category: 'Categoría', prev: 'Anterior', next: 'Siguiente',
    related: 'Artículos relacionados', sample: 'Ejemplo', tag: 'Etiquetas', author: 'Sobre el autor',
    languagePrompt: 'Tu navegador prefiere {language}. ¿Quieres cambiar de idioma?',
    switch: 'Cambiar a {language}', stay: 'Continuar en este idioma',
    notFound: 'No se encontró esta página.', notFoundDescription: 'Es posible que la dirección haya cambiado. Visita el inicio o la lista de artículos.',
  },
} as const;
export type MessageKey = keyof typeof dictionary['zh-TW'];
export function t(locale: string, key: MessageKey, variables: Record<string, string> = {}): string {
  const item = dictionary[locale as keyof typeof dictionary] ?? dictionary['zh-TW'];
  return Object.entries(variables).reduce((value, [name, replacement]) =>
    value.replaceAll('{' + name + '}', replacement), item[key] as string);
}
export function contentLocale(data: { locale?: string }, site: Site): string {
  return site.i18n.enabled ? (data.locale ?? site.i18n.defaultLocale) : site.language;
}
export function localePrefix(locale: string, site: Site): string {
  return site.i18n.enabled && locale !== site.i18n.defaultLocale ? '/' + locale.toLowerCase() : '';
}
export function localizedPath(locale: string, path: string, site: Site): string {
  const prefix = localePrefix(locale, site);
  return prefix ? prefix + (path === '/' ? '/' : path) : path;
}
export function translationGroup(data: { uid?: string; id?: string; translationKey?: string }): string {
  return data.translationKey ?? data.uid ?? data.id ?? '';
}
export function languageEnabled(site: Site): boolean {
  return site.i18n.enabled && site.i18n.locales.length > 1;
}
