import { defineConfig } from 'astro/config';
import { loadSite } from './src/lib/settings';
import { mediaImages } from './scripts/lib/remark-images';
import { canonicalPostLinks } from './scripts/lib/remark-post-links';
import { unified } from '@astrojs/markdown-remark';
const site = loadSite();
export default defineConfig({
  site: `https://${site.domain}`,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  vite: { server: { allowedHosts: ['terminal.local'] } },
  markdown: { syntaxHighlight: false, processor: unified({ remarkPlugins: [mediaImages, canonicalPostLinks] }) },
});
