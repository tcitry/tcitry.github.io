import { Badge } from '@cloudflare/kumo/components/badge';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import styles from './CloudflareProductMap.module.css';

type DocumentLink = { title: string; href: string };

const learningPath = {
  foundations: [
    { title: 'Workers', href: '/docs/Cloudflare/workers-runtime-apis-and-bindings/' },
    { title: 'Durable Objects', href: '/docs/Cloudflare/durable-objects/' },
  ],
  execution: [
    { title: 'Dynamic Workers', href: '/docs/Cloudflare/dynamic-workers-api-and-security/' },
    { title: 'Containers 与 Sandbox', href: '/docs/Cloudflare/dynamic-workers-containers-sandbox/' },
    { title: 'Sandbox SDK', href: '/docs/Cloudflare/sandbox-sdk-api-and-practice/' },
    { title: 'Cloudflare Computer', href: '/docs/Cloudflare/cloudflare-computer-workspace-runtime-agent-integration/' },
  ],
  durable: [
    { title: 'Queues', href: '/docs/Cloudflare/queues-api-and-practice/' },
    { title: 'Workflows', href: '/docs/Cloudflare/workflows-dynamic-workflows/' },
    { title: 'Workflows API', href: '/docs/Cloudflare/workflows-api-and-recovery/' },
    { title: 'Dynamic Workflows', href: '/docs/Cloudflare/dynamic-workflows-tenant-routing/' },
  ],
  decisions: [
    { title: 'Agents SDK 对比', href: '/docs/Cloudflare/convex-agent-vs-cloudflare-agents-sdk-durable-chat/' },
    { title: 'Workflows 对比', href: '/docs/Cloudflare/convex-workflows-vs-cloudflare-workflows/' },
    { title: 'R2 图片发布', href: '/docs/Cloudflare/r2-blog-image-upload/' },
  ],
} satisfies Record<string, DocumentLink[]>;

function DocumentLinks({ documents, className = '' }: { documents: DocumentLink[]; className?: string }) {
  return <ul className={`${styles.links} ${className}`}>
    {documents.map((document) => <li key={document.href}>
      <a href={document.href} target="_top">
        <span>{document.title}</span><span aria-hidden="true">→</span>
      </a>
    </li>)}
  </ul>;
}

function SideCard({ label, documents, className }: { label: string; documents: DocumentLink[]; className: string }) {
  return <section className={`${styles.stage} ${className}`} aria-label={label}>
    <LayerCard className={styles.card}>
      <LayerCard.Secondary className={styles.cardHeader}>
        <span className={styles.eyebrow}>{label}</span><Badge variant="outline">{documents.length}</Badge>
      </LayerCard.Secondary>
      <LayerCard.Primary className={`${styles.cardBody} ${styles.sideBody}`}>
        <DocumentLinks documents={documents} />
      </LayerCard.Primary>
    </LayerCard>
  </section>;
}

function CoreCard() {
  return <section className={`${styles.stage} ${styles.core}`} aria-label="执行边界与 Sandbox 实践">
    <LayerCard className={`${styles.card} ${styles.coreCard}`}>
      <LayerCard.Secondary className={styles.coreHeader}>
        <div className="flex items-center gap-[.7rem]">
          <span className={styles.mark} aria-hidden="true">C</span>
          <h2 className="m-0 text-[clamp(1.4rem,3.2vw,2rem)] font-[760] tracking-[-.04em] text-[#201f1c]">Cloudflare</h2>
        </div>
        <span className={styles.status} aria-label="学习主路径" />
      </LayerCard.Secondary>
      <LayerCard.Primary className="p-0!">
        <section className={styles.coreSection} aria-labelledby="execution-heading">
          <h3 id="execution-heading" className={`${styles.eyebrow} mb-[.58rem]!`}>EXECUTION BOUNDARY</h3>
          <DocumentLinks documents={learningPath.execution.slice(0, 2)} />
        </section>
        <section className={styles.coreSection} aria-labelledby="sandbox-heading">
          <h3 id="sandbox-heading" className={`${styles.eyebrow} mb-[.58rem]!`}>SANDBOX PRACTICE</h3>
          <DocumentLinks documents={learningPath.execution.slice(2)} />
        </section>
      </LayerCard.Primary>
    </LayerCard>
  </section>;
}

function DecisionsCard() {
  return <section className={`${styles.stage} ${styles.decisions}`} aria-label="延伸阅读">
    <LayerCard className={styles.card}>
      <LayerCard.Secondary className={styles.cardHeader}>
        <span className={styles.eyebrow}>ARCHITECTURE DECISIONS</span><Badge variant="outline">延伸阅读</Badge>
      </LayerCard.Secondary>
      <LayerCard.Primary className="px-[.78rem]! py-[.65rem]!">
        <DocumentLinks documents={learningPath.decisions} className={styles.decisionLinks} />
      </LayerCard.Primary>
    </LayerCard>
  </section>;
}

/** Static React/Kumo markup rendered by Astro; links need no client hydration. */
export default function CloudflareProductMap() {
  return <main className={styles.map} data-mode="light" data-book-island>
    <header className="mx-auto mb-[.95rem] max-w-[1180px]">
      <p className={styles.eyebrow}>LYON'S BLOG / CLOUDFLARE</p>
      <h1 className={styles.title}>Cloudflare 文档学习地图</h1>
    </header>
    <section className={styles.canvas} aria-label="Cloudflare 站内文档学习路径">
      <div className={styles.flowLine} aria-hidden="true" />
      <SideCard label="FOUNDATIONS" documents={learningPath.foundations} className={styles.foundations} />
      <CoreCard />
      <SideCard label="DURABLE FLOW" documents={learningPath.durable} className={styles.durable} />
      <DecisionsCard />
    </section>
  </main>;
}
