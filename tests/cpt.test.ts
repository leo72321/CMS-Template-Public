import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeModel, pathFor, type Cpt, type Input } from '../src/lib/model';
import { cptSchema, siteSchema } from '../src/lib/schema';
import { buildSitemapParts, renderSitemapPart } from '../src/lib/sitemap';
import { generateContentUid } from '../scripts/lib/uid';

const cars = { id:'cars', name:'車輛庫存', description:'中古車列表', indexable:true,
  fields: [
    { id:'brand', label:'廠牌', type:'text', required:true, showOnList:true },
    { id:'year', label:'年份', type:'number', required:true, showOnList:true },
    { id:'price', label:'售價', type:'price', required:true, showOnList:true },
    { id:'status', label:'車況', type:'select', options:['在售','已售出'], showOnList:true },
    { id:'photos', label:'車輛照片', type:'gallery' },
  ],
};
const site = (types: unknown[] = [cars]) => siteSchema.parse({
  domain:'cars.example.org', title:'中古車站', description:'車輛資訊', author:'編輯',
  media:{bucket:'wordpress-cdn'}, indexable:true, contentTypes:types,
});
const item = (uid: string, overrides: Record<string, unknown> = {}): Cpt => ({
  kind:'cpt',file:'content/cpt/cars/' + uid + '.md',body:'車況介紹',
  data:cptSchema.parse({
    type:'cars',uid,slug:uid,title:'Toyota ' + uid,description:'中古 Toyota',draft:false,
    fields:{brand:'Toyota',year:2022,price:580000,status:'在售',photos:[]},...overrides,
  }),
});
const inputs = (cpts: Cpt[]): Input => ({posts:[],pages:[],cpts,categories:[],tags:[],topics:[]});

test('CPT cars 跟 Blog 分開：/cars/ 列表、詳細頁、Sitemap 類型及永久 UID', () => {
  const i=inputs([item('20261023-k7m2q')]);
  const m=makeModel(i,site(),new Date('2026-10-23T08:00:00Z'));
  assert.equal(m.cpts.length,1);
  assert.equal(pathFor(i.cpts![0],[]),'/cars/20261023-k7m2q/');
  assert.equal(m.byPath.get('/cars/')?.kind,'cpt-index');
  assert.deepEqual(m.byPath.get('/cars/')?.cpts?.map(x=>x.data.uid),['20261023-k7m2q']);
  assert.equal(m.byPath.get('/cars/20261023-k7m2q/')?.kind,'cpt');
  assert.equal(m.byPath.get('/blog/')?.kind,'blog');
  const parts=buildSitemapParts(m.routes);
  assert.ok(parts.find(x=>x.filename==='cars-001.xml'));
  assert.match(renderSitemapPart(parts.find(x=>x.filename==='cars-001.xml')!,'cars.example.org'),/cars\/20261023-k7m2q/);
});

test('CPT 必填、選單值、資料型別、未知欄位、未知類型及 UID 重複都會擋',()=>{
  const bad=item('a',{fields:{brand:'Toyota',year:'2022',price:300}});
  assert.throws(()=>makeModel(inputs([bad]),site()),/欄位格式錯誤/);
  const missing=item('b',{fields:{brand:'Toyota',year:2022}});
  assert.throws(()=>makeModel(inputs([missing]),site()),/必填欄位未填/);
  const unknown=item('c',{fields:{brand:'Toyota',year:2022,price:100,status:'亂填',x:1}});
  assert.throws(()=>makeModel(inputs([unknown]),site()),/未註冊的欄位|欄位格式錯誤/);
  assert.throws(()=>makeModel(inputs([item('a')]),site([])),/沒有註冊 CPT/);
  assert.throws(()=>makeModel(inputs([item('a'),item('a')]),site()),/內容 uid 重複/);
});

test('CPT 草稿可先不填必填欄位；發布才擋，noindex 不進 Sitemap',()=>{
  const draft=item('x',{draft:true,fields:{}});
  const m=makeModel(inputs([draft]),site());
  assert.equal(m.cpts.length,0);
  const blocked=item('x',{draft:false,fields:{}});
  assert.throws(()=>makeModel(inputs([blocked]),site()),/必填欄位/);
  const hidden=item('hidden',{noindex:true});
  const h=makeModel(inputs([hidden]),site());
  assert.equal(h.byPath.get('/cars/hidden/')?.noindex,true);
  assert.ok(!buildSitemapParts(h.routes).some(x=>x.filename==='cars-001.xml'));
});

test('CPT 根路徑不能與現有 Blog/系統保留代碼、分類或 PAGE 撞名',()=>{
  assert.throws(()=>site([{...cars,id:'blog'}]),/系統保留字/);
  assert.throws(()=>site([cars,cars]),/重複/);
  const i=inputs([item('x')]);
  i.categories.push({id:'x',slug:'cars',name:'撞名',description:'',indexable:false});
  assert.throws(()=>makeModel(i,site()),/網址衝突/);
});

test('UID 台灣建檔日期＋5 位 base36，重複時重新抽，不用手填',()=>{
  let n=0;const random=()=> n++ < 5 ? 0 : 1;
  const now=new Date('2026-10-22T16:01:00.000Z');
  assert.equal(generateContentUid(new Set(),now,()=>10),'20261023-aaaaa');
  assert.equal(generateContentUid(new Set(['20261023-00000']),now,random),'20261023-11111');
});
