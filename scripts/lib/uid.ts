import { randomInt } from 'node:crypto';
import { todayTaipei } from '../../src/lib/model';

// YYYYMMDD + 5 位小寫 base36；與文章標題、slug、發佈日期無關，建立後不可修改。
export function generateContentUid(used: Set<string>, now = new Date(), random: (limit: number) => number = randomInt): string {
  const day = todayTaipei(now).replaceAll('-', '');
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  for (let attempt = 0; attempt < 200; attempt++) {
    let suffix = '';
    for (let i = 0; i < 5; i++) suffix += chars[random(36)];
    const uid = day + '-' + suffix;
    if (!used.has(uid)) return uid;
  }
  throw new Error('同一建檔日期 UID 重複太多次，拒絕建立；請重新執行。');
}
