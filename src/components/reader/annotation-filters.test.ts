import {describe, expect, test} from 'vitest';
import {annotationFilterType, annotationFilters, annotationTypeLabel, sameArticlePath} from './annotation-filters';

describe('annotation filters', () => {
  test('keeps 全部 / 划线 / 高亮 / 笔记 and maps them onto stored types', () => {
    expect(annotationFilters.map(item => item.label)).toEqual(['全部', '划线', '高亮', '笔记']);
    expect(annotationFilterType('all')).toBeUndefined();
    expect(annotationFilterType('underline')).toBe('underline');
    expect(annotationFilterType('highlight')).toBe('highlight');
    expect(annotationFilterType('note')).toBe('note');
    expect(annotationTypeLabel('note')).toBe('笔记');
  });

  test('treats a missing trailing slash as the same article', () => {
    expect(sameArticlePath('/docs/vite', '/docs/vite/')).toBe(true);
    expect(sameArticlePath('/docs/vite/', '/docs/other/')).toBe(false);
    expect(sameArticlePath('/', '/')).toBe(true);
  });
});
