import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const p='site.config.json';
const site=JSON.parse(readFileSync(p,'utf8'));
site.domain='i18n-test.example.org';
site.indexable=true;
site.i18n={enabled:true,defaultLocale:'zh-TW',locales:['zh-TW','en','es','ja','fr','pt-BR'],
  languageSuggestion:true,metadata:{
    ja:{title:'日本語サイト',description:'日本語のページについて',label:'日本語'},
    'pt-BR':{title:'Site em português',description:'Vídeos e tutoriais em português'}
  },messages:{ja:{home:'ホーム',blog:'すべての記事',languagePrompt:'ブラウザの言語は{language}です。切り替えますか？'}}};
site.headerNavPages=[...new Set([...(site.headerNavPages??['about']),'i18n-fixture'])];
writeFileSync(p,JSON.stringify(site,null,2)+'\n');
for(const d of [
  {file:'i18n-fixture',uid:'i18n-fixture',title:'多語言測試文章',slug:'i18n-fixture',locale:null},
  {file:'i18n-english',uid:'i18n-english',title:'Multilingual test page',slug:'i18n-english',locale:'en'},
  {file:'i18n-spanish',uid:'i18n-spanish',title:'Página de prueba multilingüe',slug:'i18n-espanol',locale:'es'},
  {file:'i18n-japanese',uid:'i18n-japanese',title:'日本語のテストページ',slug:'nihongo',locale:'ja'},
  {file:'i18n-french',uid:'i18n-french',title:'Page de démonstration en français',slug:'bonjour',locale:'fr'},
  {file:'i18n-portuguese',uid:'i18n-portuguese',title:'Página de teste em português',slug:'video-em-portugues',locale:'pt-BR'},
]){
  const locale=d.locale ? 'locale: '+d.locale+'\ntranslationKey: i18n-fixture\n' : '';
  writeFileSync(join('content/pages',d.file+'.md'),'---\nuid: '+d.uid+'\ntitle: '+d.title+
    '\ndescription: Content used for multilingual integration acceptance.\nslug: '+d.slug+
    '\ndraft: false\n'+locale+'---\n\n## Test content\n\nMultilingual integration fixture.\n');
}
