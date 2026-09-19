type FollowUpSource = {title: string};

const FALLBACKS = [
  '能再展开说明一下吗？',
  '有哪些常见的误区或注意事项？',
  '有没有更具体的实践建议？',
];

function normalize(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number) {
  const value = normalize(text);
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Derive 2–3 short follow-up prompts from a completed assistant turn. */
export function deriveFollowUpSuggestions(question: string, answer: string, sources: FollowUpSource[] = []) {
  const suggestions: string[] = [];
  const cleanAnswer = answer.replace(/\[(\d+)\]/g, '').trim();
  const cleanQuestion = normalize(question);

  for (const match of cleanAnswer.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const topic = clip(match[1].replace(/[*_`]/g, ''), 32);
    if (topic.length >= 4) suggestions.push(`「${topic}」能再具体说明一下吗？`);
  }

  for (const source of sources) {
    const title = clip(source.title, 28);
    if (title.length >= 4) suggestions.push(`结合《${title}》还有哪些值得注意的细节？`);
  }

  if (cleanQuestion.length >= 6) {
    suggestions.push('能再总结一下关键要点吗？');
    suggestions.push('如果要在项目里落地，第一步通常是什么？');
  }

  const unique = [...new Set(suggestions.map(normalize).filter(item => item.length >= 6 && item !== cleanQuestion))];
  for (const fallback of FALLBACKS) {
    if (unique.length >= 3) break;
    if (!unique.includes(fallback) && fallback !== cleanQuestion) unique.push(fallback);
  }
  return unique.slice(0, 3).length >= 2 ? unique.slice(0, 3) : unique.slice(0, 2);
}
