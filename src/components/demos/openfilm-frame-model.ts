/** A two-page teaching fixture for OpenFilm e0a80d5, not a replacement runtime. */
export const OPENFILM_REVISION = 'e0a80d515fa13457ece08925575d5453c0b0fc6d';
export const FILM_DURATION = 6;
export const REFERENCE_TIME = 3;
export const FILM_HTML = `<section id="titles">
  <iframe src="title.html#t=1,4" at="2"></iframe>
</section>
<section id="background">
  <iframe src="background.html#t=0,6"></iframe>
</section>`;

export const PAGE_CLIPS = [
  {id: 'title', file: 'title.html', at: 2, in: 1, out: 4, native: 4, track: 0},
  {id: 'background', file: 'background.html', at: 0, in: 0, out: 6, native: 6, track: 1},
] as const;
export type PageId = typeof PAGE_CLIPS[number]['id'];

export function frameAt(request: number) {
  const t = Number.isFinite(request) ? Math.max(0, Math.min(FILM_DURATION, request)) : 0;
  const pages = PAGE_CLIPS.map(clip => {
    const end = clip.at + clip.out - clip.in; // HTML pages always have speed 1.
    const active = t >= clip.at && t < end;
    return {...clip, end, active, sourceTime: active ? Math.min(clip.in + t - clip.at, clip.native - 0.001) : null};
  });
  const title = pages[0]!;
  const background = pages[1]!;
  return {
    t, title, background,
    sunX: 54 + 34 * (background.sourceTime ?? 0),
    titleOpacity: title.active ? 1 : 0,
    titleY: 132 - 8 * (title.sourceTime ?? 0),
    explanation: t < 2
      ? '标题尚未到影片中的开始时间。运行时只请求背景页，合成帧里没有标题。'
      : t < 5
        ? `标题已经进入影片 ${(t - 2).toFixed(1)} 秒，加上源起点 1 秒，收到 frame(${(title.sourceTime ?? 0).toFixed(1)})。它绘制的透明画面盖在背景之上。`
        : t < 6
          ? '第 5 秒起，标题片段已结束。运行时隐藏标题层；背景页继续按影片时间绘制。'
          : '第 6 秒是影片结束边界，两段都已结束。此处显示边界状态，不把它算作额外一帧。',
  };
}
export type FilmFrame = ReturnType<typeof frameAt>;
export const TOUR_TIMES = [0.5, 2, 3, 4.5, 5, 3];
