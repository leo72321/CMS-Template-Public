import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

test('CPT 真正執行 Astro build，確認 Cars 列表、詳細頁、價格及 Sitemap 產物', { timeout: 120000 }, () => {
  const origin = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), 'cms-cpt-build-'));
  try {
    cpSync(origin, temp, { recursive: true, filter: src => {
      if (src === origin) return true;
      const name = basename(src);
      return !['.git', 'node_modules', 'dist', '.astro', '.reports', '.cache'].includes(name);
    } });
    symlinkSync(join(origin, 'node_modules'), join(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const config = JSON.parse(readFileSync(join(temp,'site.config.json'),'utf8'));
    config.domain='cars.example.org';config.indexable=true;
    config.contentTypes=[{id:'cars',name:'車輛庫存',description:'公開車輛',indexable:true,
      fields:[{id:'brand',label:'廠牌',type:'text',required:true,showOnList:true},
        {id:'price',label:'售價',type:'price',required:true,showOnList:true},
        {id:'report',label:'車況報告',type:'file'}]}];
    writeFileSync(join(temp,'site.config.json'),JSON.stringify(config,null,2)+'\n');
    const target=join(temp,'content','cpt','cars');
    mkdirSync(target,{recursive:true});
    writeFileSync(join(target,'20261023-k7m2q--toyota-altis.md'),[
      '---','type: cars','uid: 20261023-k7m2q','title: Toyota Altis','slug: toyota-altis',
      'description: 二手 Toyota Altis','draft: false','fields:','  brand: Toyota','  price: 580000','---','',
      '## 車況', '', '里程正常，歡迎預約看車。','',
    ].join('\n'));
    // 真正呼叫 media:add 的 CLI：預覽 PDF 寫入 CPT 欄位，不用 KEY、不上傳。
    const documentFile = join(temp, 'fixture.pdf');
    writeFileSync(documentFile, '%PDF-1.4\nlocal fixture');
    const dry = spawnSync('npm', ['run','media:add','--','--uid','20261023-k7m2q',
      '--file',documentFile,'--field','report','--dry-run'], {
      cwd:temp, encoding:'utf8', timeout:30000, env:{...process.env,CI:'1'}, maxBuffer:2*1024*1024,
    });
    assert.equal(dry.status,0,(dry.stdout+'\n'+dry.stderr).slice(-6000));
    assert.match(dry.stdout,/cars\/20261023-k7m2q\/report-/);
    assert.match(dry.stdout,/fields.report/);
    assert.ok(!readFileSync(join(target,'20261023-k7m2q--toyota-altis.md'),'utf8').includes('fixture.pdf'),
      'dry-run 不可修改內容');
    const result=spawnSync('npm',['run','build'],{cwd:temp,encoding:'utf8',timeout:105000,
      env:{...process.env,CI:'1',CF_PAGES:'0',SITE_PREVIEW:'0'},maxBuffer:4*1024*1024});
    assert.equal(result.status,0,(result.stdout+'\n'+result.stderr).slice(-8000));
    const listing=join(temp,'dist','cars','index.html');
    const detail=join(temp,'dist','cars','toyota-altis','index.html');
    assert.ok(existsSync(listing),'Cars 列表未輸出');
    assert.ok(existsSync(detail),'Cars 詳細頁未輸出');
    assert.match(readFileSync(listing,'utf8'),/cars\/toyota-altis/);
    assert.match(readFileSync(detail,'utf8'),/NT\$580,000/);
    assert.ok(existsSync(join(temp,'dist','cars-001.xml')),'缺少 CPT 專屬 Sitemap');
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});
