import type { CptData, ContentTypeDefinition } from './schema';

export function validateCptFields(data: CptData, definition: ContentTypeDefinition): void {
  const config = new Map(definition.fields.map(field => [field.id, field]));
  const errors: string[] = [];
  for (const name of Object.keys(data.fields)) {
    if (!config.has(name)) errors.push('未註冊的欄位：' + name);
  }
  for (const field of definition.fields) {
    const value = data.fields[field.id];
    if (value === undefined || value === '') {
      if (field.required && !data.draft) errors.push('必填欄位未填：' + field.label + '（' + field.id + '）');
      continue;
    }
    const kind = field.type;
    const isLink = (text: string) => {
      if (text.startsWith('/') && !text.startsWith('//') && !text.includes('..') && !/[?#]/.test(text)) return true;
      try { const url = new URL(text); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
    };
    let valid = false;
    switch (kind) {
      case 'text': valid = typeof value === 'string' && value.length <= 3000; break;
      case 'select': valid = typeof value === 'string' && !!field.options?.includes(value); break;
      case 'number': valid = typeof value === 'number' && Number.isFinite(value); break;
      case 'price': valid = typeof value === 'number' && Number.isFinite(value) && value >= 0; break;
      case 'boolean': valid = typeof value === 'boolean'; break;
      case 'date': valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value); break;
      case 'url':
      case 'image':
      case 'file': valid = typeof value === 'string' && isLink(value); break;
      case 'gallery': valid = Array.isArray(value) && value.every(v => typeof v === 'string' && isLink(v)) && value.length <= 50; break;
    }
    if (!valid) errors.push('欄位格式錯誤：' + field.label + '（' + kind + '）');
  }
  if (errors.length) throw new Error('CPT ' + definition.id + '（' + data.uid + '）欄位錯誤：\n' + errors.join('\n'));
}

export function formatCptValue(value: CptData['fields'][string], field: ContentTypeDefinition['fields'][number]): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number' && field.type === 'price') return 'NT$' + new Intl.NumberFormat('zh-TW').format(value);
  if (typeof value === 'number') return new Intl.NumberFormat('zh-TW').format(value);
  if (Array.isArray(value)) return String(value.length) + ' 張圖片';
  return String(value ?? '');
}
