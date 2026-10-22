import { z } from 'zod';
import type { Site } from './schema';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const recordSchema = z.object({
  createdAt: day,
  sequence: z.number().int().positive(),
  target: z.string().startsWith('/'),
  retiredAt: day.optional(),
  retiredReason: z.enum(['capacity', 'age']).optional(),
}).strict();

export const redirectHistorySchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string().startsWith('/'), recordSchema),
  alerts: z.object({
    milestones: z.array(z.number().int()).default([]),
    above1950HighWater: z.number().int().nonnegative().default(1950),
  }).strict(),
}).strict();
export type RedirectHistory = z.infer<typeof redirectHistorySchema>;
export type RedirectNotice = { kind: 'milestone' | 'above1950'; count: number; message: string };
export type RedirectResult = {
  redirects: Map<string, string>;
  history: RedirectHistory;
  notices: RedirectNotice[];
  retired: { from: string; reason: 'capacity' | 'age' }[];
  candidates: number;
};

export const emptyRedirectHistory = (): RedirectHistory => ({
  version: 1,
  entries: {},
  alerts: { milestones: [], above1950HighWater: 1950 },
});

const taipeiDay = (now: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

const elapsedDays = (from: string, to: string) =>
  Math.floor((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

export function manageRedirects(
  candidates: Map<string, string>,
  previous: RedirectHistory | undefined,
  policy: Site['redirectManagement'],
  now = new Date(),
): RedirectResult {
  const history = redirectHistorySchema.parse(previous ?? emptyRedirectHistory());
  const entries: RedirectHistory['entries'] = Object.fromEntries(
    Object.entries(history.entries).map(([path, item]) => [path, { ...item }]),
  );
  const alerts = { milestones: [...history.alerts.milestones], above1950HighWater: history.alerts.above1950HighWater };
  const today = taipeiDay(now);
  let sequence = Math.max(0, ...Object.values(entries).map(r => r.sequence));
  for (const [from, to] of candidates) {
    if (!entries[from]) entries[from] = { createdAt: today, sequence: ++sequence, target: to };
    else if (!entries[from].retiredAt) entries[from].target = to;
  }
  const live = [...candidates].filter(([from]) => !entries[from].retiredAt);
  const oldestFirst = (a: [string, string], b: [string, string]) =>
    entries[a[0]].createdAt.localeCompare(entries[b[0]].createdAt)
    || entries[a[0]].sequence - entries[b[0]].sequence
    || a[0].localeCompare(b[0]);
  const retired: RedirectResult['retired'] = [];
  const retire = (from: string, reason: 'capacity' | 'age') => {
    if (entries[from].retiredAt) return;
    entries[from].retiredAt = today;
    entries[from].retiredReason = reason;
    retired.push({ from, reason });
  };
  if (policy.agePrune.enabled) {
    for (const [from] of live) {
      if (elapsedDays(entries[from].createdAt, today) > policy.agePrune.days) retire(from, 'age');
    }
  }
  const survivors = live.filter(([from]) => !entries[from].retiredAt).sort(oldestFirst);
  if (survivors.length > policy.maxActive) {
    if (!policy.overflowAutoPrune) throw new Error(
      '301 轉址規則已超過 ' + policy.maxActive + ' 條，且容量保護自動淘汰已關閉。請處理後再部署。',
    );
    for (const [from] of survivors.slice(0, survivors.length - policy.maxActive)) retire(from, 'capacity');
  }
  const redirects = new Map([...candidates].filter(([from]) => !entries[from].retiredAt));
  if (redirects.size > policy.maxActive) throw new Error('301 轉址容量防呆失敗，拒絕部署超額規則。');
  const notices: RedirectNotice[] = [];
  // 警示以所有候選規則的總數為準，避免自動淘汰後計數永遠停在 1950。
  const count = candidates.size;
  for (const threshold of [1500, 1800, 1950]) {
    if (count >= threshold && !alerts.milestones.includes(threshold)) {
      notices.push({ kind: 'milestone', count: threshold, message: '301 轉址已達 ' + threshold + ' 條（目前候選 ' + count + ' 條）。' });
      alerts.milestones.push(threshold);
    }
  }
  for (let n = Math.max(1950, alerts.above1950HighWater) + 1; n <= count; n++) {
    notices.push({ kind: 'above1950', count: n, message: '301 轉址候選規則增加至 ' + n + ' 條，已依容量上限保留最新 ' + policy.maxActive + ' 條。' });
  }
  alerts.above1950HighWater = Math.max(alerts.above1950HighWater, count);
  return { redirects, history: { version: 1, entries, alerts }, notices, retired, candidates: count };
}
