import {useEffect, useRef, useState} from 'react';
import {trackDemoStart} from '../../lib/analytics';
import styles from './ScrollCapsuleNavbar.module.css';

const collapseAt = 30;
const expandAt = 8;
const sections = ['Overview', 'Anatomy', 'Motion', 'Verification'];

export default function ScrollCapsuleNavbar() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    let frame = 0;
    const readPosition = () => {
      frame = 0;
      const next = scrolledRef.current
        ? viewport.scrollTop > expandAt
        : viewport.scrollTop > collapseAt;

      if (next !== scrolledRef.current) {
        scrolledRef.current = next;
        setIsScrolled(next);
      }
    };
    const scheduleRead = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(readPosition);
      }
    };

    viewport.addEventListener('scroll', scheduleRead, {passive: true});
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', scheduleRead);
    };
  }, []);

  function moveTo(scrollTop: number, action: string) {
    viewportRef.current?.scrollTo({top: scrollTop, behavior: 'smooth'});
    trackDemoStart('scroll-capsule-navbar', action);
  }

  return (
    <section className={styles.demo} data-demo="scroll-capsule-navbar" aria-label="滚动收缩玻璃导航演示">
      <div className={styles.toolbar}>
        <div>
          <strong>Scroll-aware capsule</strong>
          <span>向下滚动，观察全宽导航收缩为玻璃胶囊。</span>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" onClick={() => moveTo(0, 'expand')}>回到顶部</button>
          <button type="button" onClick={() => moveTo(180, 'collapse')}>查看胶囊</button>
        </div>
      </div>

      <div className={styles.viewport} ref={viewportRef}>
        <div className={styles.navbarShell} data-scrolled={isScrolled}>
          <nav className={styles.navbar} aria-label="案例导航">
            <a className={styles.brand} href="#capsule-intro">Arc</a>
            <div className={styles.links}>
              {sections.map(section => <a href={`#capsule-${section.toLowerCase()}`} key={section}>{section}</a>)}
            </div>
            <a className={styles.action} href="#capsule-verification">Inspect state</a>
          </nav>
        </div>

        <article className={styles.content} id="capsule-intro">
          <p className={styles.eyebrow}>Interaction study · 01</p>
          <h2>One surface,<br />two spatial states.</h2>
          <p>顶部状态让导航融入首屏；滚动状态缩短宽度、增加高度，并显示稳定的玻璃表面。</p>
          {sections.map((section, index) => (
            <section id={`capsule-${section.toLowerCase()}`} key={section}>
              <span>0{index + 2}</span>
              <h3>{section}</h3>
              <p>{index === 0 ? '导航只维护一个布尔状态，视觉变化全部交给 CSS。' : index === 1 ? '外层控制位置与宽度，内层 nav 只负责品牌、链接和操作。' : index === 2 ? '双阈值避免临界滚动位置反复切换，requestAnimationFrame 合并高频读取。' : '滚动超过 30px 后进入胶囊状态，回到 8px 内恢复展开状态。'}</p>
            </section>
          ))}
        </article>
      </div>
      <noscript><p className={styles.noScript}>启用 JavaScript 后可观察滚动状态切换。</p></noscript>
    </section>
  );
}
