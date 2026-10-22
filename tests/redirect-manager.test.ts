import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRedirectHistory, manageRedirects } from '../src/lib/redirect-manager';
import { siteSchema } from '../src/lib/schema';

const site = siteSchema.parse({
  domain: 'test.example.org', title: '測試', description: '測試說明', author: '作者', media: { bucket: 'example' },
});
const policy = site.redirectManagement;
const current = (count: number) => new Map(Array.from({ length: count }, (_, i) => [
  '/old-' + String(i).padStart(5, '0') + '/',
  '/new-' + String(i).padStart(5, '0') + '/',
]));
const now = new Date('2026-10-23T02:00:00Z');

test('公版預設容量 1950、在 1500／1800／1950 各提醒一次', () => {
  assert.deepEqual(policy, { maxActive: 1950, overflowAutoPrune: true, agePrune: { enabled: false, days: 90 } });
  const a = manageRedirects(current(1500), undefined, policy, now);
  assert.deepEqual(a.notices.map(x => x.count), [1500]);
  const b = manageRedirects(current(1800), a.history, policy, now);
  assert.deepEqual(b.notices.map(x => x.count), [1800]);
  const c = manageRedirects(current(1950), b.history, policy, now);
  assert.deepEqual(c.notices.map(x => x.count), [1950]);
  assert.equal(c.redirects.size, 1950);
  assert.equal(manageRedirects(current(1950), c.history, policy, now).notices.length, 0);
});

test('1950 後每新增一條發一次新提醒，超額淘汰建立順序最早者且不復活', () => {
  let prior = manageRedirects(current(1950), undefined, policy, now);
  let n = manageRedirects(current(1951), prior.history, policy, now);
  assert.equal(n.redirects.size, 1950);
  assert.deepEqual(n.notices.filter(e => e.kind === 'above1950').map(e => e.count), [1951]);
  assert.deepEqual(n.retired.map(r => r.from), ['/old-00000/']);
  assert.equal(n.history.entries['/old-00000/'].retiredReason, 'capacity');
  const repeat = manageRedirects(current(1951), n.history, policy, now);
  assert.equal(repeat.notices.length, 0);
  assert.equal(repeat.redirects.has('/old-00000/'), false);
  assert.equal(repeat.retired.length, 0);
  n = manageRedirects(current(1952), repeat.history, policy, now);
  assert.deepEqual(n.notices.map(e => e.count), [1952]);
  assert.deepEqual(n.retired.map(e => e.from), ['/old-00001/']);
  assert.equal(n.redirects.size, 1950);
  assert.equal(n.history.entries['/old-00000/'].retiredAt, '2026-10-23');
});

test('建立日期按首次觀測保留；來源沒有日期時不能假造過去的建置時間', () => {
  const first = manageRedirects(current(3), undefined, policy, new Date('2026-10-23T01:00:00Z'));
  const later = manageRedirects(current(3), first.history, policy, new Date('2027-02-01T01:00:00Z'));
  assert.equal(first.history.entries['/old-00000/'].createdAt, '2026-10-23');
  assert.equal(later.history.entries['/old-00000/'].createdAt, '2026-10-23');
  assert.equal(later.retired.length, 0, '90 天日期清理預設關閉');
});

test('90 天以上依建立時間清理可單獨啟用，關閉容量防呆則拒絕超額建置', () => {
  const first = manageRedirects(current(2), emptyRedirectHistory(), policy, new Date('2026-01-01T02:00:00Z'));
  const a = manageRedirects(current(2), first.history,
    { ...policy, agePrune: { enabled: true, days: 90 } }, new Date('2026-04-05T02:00:00Z'));
  assert.equal(a.redirects.size, 0);
  assert.equal(a.retired.length, 2);
  assert.ok(a.retired.every(x => x.reason === 'age'));
  assert.throws(() => manageRedirects(current(1951), undefined,
    { ...policy, overflowAutoPrune: false }, now), /超過 1950/);
});

test('重新部署不能恢復 tombstone：以前被清理的網址保留退役註記', () => {
  const a = manageRedirects(current(1), undefined, policy, now);
  const old = { ...a.history, entries: {
    ...a.history.entries,
    '/old-00000/': { ...a.history.entries['/old-00000/'], retiredAt: '2026-10-23', retiredReason: 'capacity' as const },
  }};
  const b = manageRedirects(current(2), old, policy, now);
  assert.equal(b.redirects.has('/old-00000/'), false);
  assert.equal(b.redirects.has('/old-00001/'), true);
  assert.equal(b.history.entries['/old-00000/'].retiredReason, 'capacity');
});
