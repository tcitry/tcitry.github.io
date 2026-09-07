# 仓库约定

## Astro 生产与预览

- `main` 是 Astro 生产及默认分支，`astro` 保留迁移历史并可用于本地验证，不对应远端环境。切换前的默认分支实际名为 `master`；保留该旧分支。`hugo-book` 的远端备份 `ce25b344d48e561f6420f727f43509c4f478e8d9` 包含旧生产提交 `d02f8b83854f7eff39b32b00c1d585d4f3567d7c` 和后续已提交的 Hugo 工作。
- 仅保留生产 Worker `tcitry-blog`，使用 `wrangler.production.jsonc` 与 `PUBLIC_SITE_ENV=production`。先本地 review，再执行 `build:production` / `verify:production` / `deploy:production`（或 `deploy`）。普通 `build` 默认生成本地 noindex 预览产物；不得将它发布到生产域名。迁移使用的远端 preview 环境已停用，不再创建预览 Worker。
- `build:workers` 只生成生产产物。当前采用本地检查后手动 Wrangler 发布；Workers Builds 仅为未来可选方案，Git 集成、构建 secrets 和内容 Deploy Hook 尚未接通。公开主题 CI 成功不能当作博客已部署。旧 Hugo GitHub Pages 工作流已停用，GitHub Pages 自定义域名按持续部署文档由用户手动移除。
- `www.yindongliang.com` 通过 Cloudflare Redirect Rule 301 跳转到主域，保持路径和查询参数，不使用额外 Worker。主站日常发布无需修改这项稳定规则。
- 首次检出使用 `npm run setup`，先准备固定提交的 `@tcitry/astro-book` 包，再安装站点锁定依赖。主题在独立公开仓库维护，使用公开导出，不把主题实现复制到本站。
- `BLOG_DIR` 是只读内容源。私有内容、生成文件、凭据和安装后的商业组件源码不得进入 Git。React / HeroUI Pro demo 包装组件属于本站，不属于公开主题。
- 修改主题或渲染后，运行站点 build、check、tests 和 verify；生产验收使用对应的 production 命令。保持旧 URL 基线和 Giscus pathname term。
- Astro 的 Giscus 配置与页面适用条件位于 `src/layouts/BookLayout.astro`，主题将评论放在页脚前后篇导航之后。下面的 Hugo 路径仅适用于保留的 Hugo 实现。

## Giscus 评论

- Hugo 从 `layouts/partials/docs/inject/footer.html` 注入 Giscus，保证页脚前后篇导航位于评论上方。保持 `data-mapping="pathname"`，除非已审计的迁移明确改变它。
- Hugo 仅对 `.IsPage` 注入 Giscus；Docs 分区索引页（如 `/docs/Apple/`）的 pathname 前缀可能模糊匹配到子文章的 Discussion。
- 现有 GitHub Discussions 保留旧页面标题并包含 Giscus pathname term。该 term 是客户端 `location.pathname.substring(1)`：没有开头 `/`，保留 URL 百分号编码和结尾 `/`；根页面使用 `index`。
- 页面标题变化但最终 pathname term 不变时，验证渲染结果，通常无需修改 Discussion。slug、permalink、目录或分区变化时，先更新现有 Discussion 标题，保留旧 term 和最终 term，再发布页面。
- 审计和远端更新使用 `/Users/yindongliang/Blog/skills/giscus-discussion-compatibility/SKILL.md`。优先使用 GitHub MCP；仅在形成可审计的映射计划后，才回退到已认证的 GitHub GraphQL。映射维护期间不得创建或删除 Discussion，也不得修改其正文、分类、状态、评论或 reaction。
- URL alias 和重定向与 Giscus 匹配相互独立。除非用户要求保留历史链接，不要仅为评论迁移添加它们。
