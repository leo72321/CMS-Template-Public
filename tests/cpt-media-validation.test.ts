import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cptSchema, contentTypeSchema } from '../src/lib/schema';
import { validateCptMediaAssets } from '../scripts/lib/cpt-media-validation';
import type { Cpt } from '../src/lib/model';

const type = contentTypeSchema.parse({ id: 'cars', name: '車輛',
  fields: [{id:'photos',label:'相簿',type:'gallery',required:true},
           {id:'report',label:'報告',type:'file'}] });
const url = 'https://cdn.example.com/car.webp';
const item = (photos: string[]): Cpt => ({kind:'cpt',file:'content/cpt/cars/car.md',body:'## 汽車',
  data:cptSchema.parse({type:'cars',uid:'car',slug:'car',title:'車輛',description:'說明',
    draft:false,fields:{photos}}) });
const valid = {url,sha1:'a'.repeat(40),verifiedAt:'2026-10-23T12:00:00Z',width:800,height:600};
test('CPT 匯入相簿必須有真實媒體校驗收據與尺寸',()=>{
  assert.throws(()=>validateCptMediaAssets(item([url]),type,new Map()),/缺少有效校驗收據/);
  assert.throws(()=>validateCptMediaAssets(item([url]),type,new Map([[url,{...valid,width:undefined}]])),/缺少真實寬高/);
  assert.doesNotThrow(()=>validateCptMediaAssets(item([url]),type,new Map([[url,valid]])));
});
test('CPT 匯入本機相簿必須存在於 public，不允許路徑穿越',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cpt-images-'));
 try {
   mkdirSync(join(dir,'assets'));writeFileSync(join(dir,'assets','car.jpg'),'jpg');
   assert.doesNotThrow(()=>validateCptMediaAssets(item(['/assets/car.jpg']),type,new Map(),dir));
   assert.throws(()=>validateCptMediaAssets(item(['/assets/lost.jpg']),type,new Map(),dir),/不存在/);
   assert.throws(()=>validateCptMediaAssets(item(['/../missing']),type,new Map(),dir),/不存在|超出/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
