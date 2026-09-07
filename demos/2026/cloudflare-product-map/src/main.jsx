import { createRoot } from "react-dom/client";
import { Badge } from "@cloudflare/kumo/components/badge";
import { LayerCard } from "@cloudflare/kumo/components/layer-card";
import "@cloudflare/kumo/styles/standalone";
import "./styles.css";

const learningPath = {
  foundations: [
    { title: "Workers", href: "/docs/Cloudflare/workers-runtime-apis-and-bindings/" },
    { title: "Durable Objects", href: "/docs/Cloudflare/durable-objects/" }
  ],
  execution: [
    { title: "Dynamic Workers", href: "/docs/Cloudflare/dynamic-workers-api-and-security/" },
    { title: "Containers 与 Sandbox", href: "/docs/Cloudflare/dynamic-workers-containers-sandbox/" },
    { title: "Sandbox SDK", href: "/docs/Cloudflare/sandbox-sdk-api-and-practice/" },
    {
      title: "Cloudflare Computer",
      href: "/docs/Cloudflare/cloudflare-computer-workspace-runtime-agent-integration/"
    }
  ],
  durable: [
    { title: "Queues", href: "/docs/Cloudflare/queues-api-and-practice/" },
    { title: "Workflows", href: "/docs/Cloudflare/workflows-dynamic-workflows/" },
    { title: "Workflows API", href: "/docs/Cloudflare/workflows-api-and-recovery/" },
    { title: "Dynamic Workflows", href: "/docs/Cloudflare/dynamic-workflows-tenant-routing/" }
  ],
  decisions: [
    {
      title: "Agents SDK 对比",
      href: "/docs/Cloudflare/convex-agent-vs-cloudflare-agents-sdk-durable-chat/"
    },
    {
      title: "Workflows 对比",
      href: "/docs/Cloudflare/convex-workflows-vs-cloudflare-workflows/"
    },
    { title: "R2 图片发布", href: "/docs/Cloudflare/r2-blog-image-upload/" }
  ]
};

function DocumentLinks({ documents, className = "" }) {
  return (
    <ul className={`learning-map__links ${className}`.trim()}>
      {documents.map((document) => (
        <li key={document.href}>
          <a href={document.href} target="_top">
            <span>{document.title}</span>
            <span aria-hidden="true">→</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SideCard({ label, documents, className }) {
  return (
    <section className={`learning-map__stage ${className}`} aria-label={label}>
      <LayerCard className="learning-map__card">
        <LayerCard.Secondary className="learning-map__card-header">
          <span>{label}</span>
          <Badge variant="outline">{documents.length}</Badge>
        </LayerCard.Secondary>
        <LayerCard.Primary className="learning-map__card-body learning-map__card-body--side">
          <DocumentLinks documents={documents} />
        </LayerCard.Primary>
      </LayerCard>
    </section>
  );
}

function CoreCard() {
  return (
    <section className="learning-map__stage learning-map__stage--core" aria-label="执行边界与 Sandbox 实践">
      <LayerCard className="learning-map__card learning-map__card--core">
        <LayerCard.Secondary className="learning-map__core-header">
          <div>
            <span className="learning-map__mark" aria-hidden="true">C</span>
            <h2>Cloudflare</h2>
          </div>
          <span className="learning-map__status" aria-label="学习主路径" />
        </LayerCard.Secondary>
        <LayerCard.Primary className="learning-map__card-body learning-map__card-body--core">
          <section className="learning-map__core-section" aria-labelledby="execution-heading">
            <h3 id="execution-heading">EXECUTION BOUNDARY</h3>
            <DocumentLinks documents={learningPath.execution.slice(0, 2)} />
          </section>
          <section className="learning-map__core-section" aria-labelledby="sandbox-heading">
            <h3 id="sandbox-heading">SANDBOX PRACTICE</h3>
            <DocumentLinks documents={learningPath.execution.slice(2)} />
          </section>
        </LayerCard.Primary>
      </LayerCard>
    </section>
  );
}

function DecisionsCard() {
  return (
    <section className="learning-map__stage learning-map__stage--decisions" aria-label="延伸阅读">
      <LayerCard className="learning-map__card learning-map__card--decisions">
        <LayerCard.Secondary className="learning-map__card-header">
          <span>ARCHITECTURE DECISIONS</span>
          <Badge variant="outline">延伸阅读</Badge>
        </LayerCard.Secondary>
        <LayerCard.Primary className="learning-map__card-body learning-map__card-body--decisions">
          <DocumentLinks documents={learningPath.decisions} className="learning-map__links--decisions" />
        </LayerCard.Primary>
      </LayerCard>
    </section>
  );
}

function App() {
  return (
    <main className="learning-map" data-mode="light">
      <header className="learning-map__intro">
        <p>LYON'S BLOG / CLOUDFLARE</p>
        <h1>Cloudflare 文档学习地图</h1>
      </header>

      <section className="learning-map__canvas" aria-label="Cloudflare 站内文档学习路径">
        <div className="learning-map__flow-line" aria-hidden="true" />
        <SideCard
          label="FOUNDATIONS"
          documents={learningPath.foundations}
          className="learning-map__stage--foundations"
        />
        <CoreCard />
        <SideCard
          label="DURABLE FLOW"
          documents={learningPath.durable}
          className="learning-map__stage--durable"
        />
        <DecisionsCard />
      </section>
    </main>
  );
}

const app = document.querySelector("#app");

if (!app) {
  throw new Error("缺少 #app 挂载元素。");
}

createRoot(app).render(<App />);
