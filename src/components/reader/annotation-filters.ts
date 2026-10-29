export const annotationFilters = [
  {id: 'all', label: '全部'},
  {id: 'highlight', label: '高亮'},
  {id: 'note', label: '笔记'},
] as const;

export type AnnotationFilter = typeof annotationFilters[number]['id'];
export type AnnotationType = Exclude<AnnotationFilter, 'all'>;

export function annotationFilterType(filter: AnnotationFilter): AnnotationType | undefined {
  return filter === 'all' ? undefined : filter;
}

export function annotationTypeLabel(type: AnnotationType) {
  return annotationFilters.find(item => item.id === type)?.label ?? '笔记';
}

export function sameArticlePath(current: string, pathname: string) {
  const normalize = (value: string) => {
    if (!value.startsWith('/')) return value;
    if (value === '/' || value.endsWith('/')) return value;
    return `${value}/`;
  };
  return normalize(current) === normalize(pathname);
}
