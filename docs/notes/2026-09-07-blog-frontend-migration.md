# Blog 前端迁移决策（历史）

- 日期：2026-09-07
- 状态：已完成
- 决策：从 Hugo Book 迁移到 Astro，并使用 Cloudflare Workers Static Assets 托管。

## 决策

站点采用 Astro 作为内容和页面编排层，保留 Markdown 内容源、历史 URL、taxonomy、feed 与 Book 三栏阅读体验。React、Svelte、Three.js 等交互按页面需要作为 islands 或独立 demo 加载，不把整站绑定到单一 UI 框架。

通用 Book 主题维护在独立 `@tcitry/astro-book` 包，本站只维护业务覆写。Blog 内容仓库继续独立写作，站点构建从固定内容提交生成静态产物。

选择 Astro 而非 Fumadocs、Starlight 或裸 Vite 的主要原因是：本站已有高度定制的内容模型和阅读布局，并需要长期容纳多框架实验。框架迁移不能改变公开 URL、内容边界和可访问性要求。

## 长期约束

- `package.json` 是当前构建与发布入口。
- `main` 是当前生产分支；旧 Hugo 实现保存在 `hugo-book` / `master`。
- `BLOG_DIR` 保持只读，私有内容不进入站点仓库或公开产物。
- 历史 URL、canonical、锚点、taxonomy、RSS、sitemap 和旧内容兼容由自动化验证保护。
- 普通内容页保持静态可读；交互和 AI 服务不可用时不能影响正文访问。

当前架构与操作说明见：

- [构建与发布](../docs/continuous-deployment.md)
- [本地验收](../docs/astro-preview.md)
- [演示与交互文章](../docs/demo-authoring.md)
