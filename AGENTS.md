# 仓库约定

## 开发边界

- 与用户使用中文交流，站点统一称为 `tcitry-blog`。
- 站点功能只在本仓库处理；仅在用户明确要求时向独立 Blog 内容仓库写入文档。
- 日常在 `main` 工作。迁移前主分支是 `master`，Hugo 备份位于 `hugo-book` / `master`；除历史核对外不修改旧实现。
- 本站使用 Astro + `@tcitry/astro-book`。业务覆写维护在 `src/`，通用主题维护在独立 astro-book 仓库；主题改动先发布准确 npm 版本，再更新本站依赖和 lockfile。
- `package.json` 是安装、开发、检查、构建和发布命令的唯一事实来源。首次检出运行 `npm run setup`。
- `BLOG_DIR` 是只读内容源。私有内容、生成文件、凭据、本机路径和安装后的商业组件源码不得进入 Git。
- 修改 Convex 代码前先读 `convex/_generated/ai/guidelines.md`。
- 改写 Blog 技术文档时读取 `skills/blog-technical-docs/SKILL.md`，并以 Blog 内容仓库当前规则为准。

## 产品与内容约束

- 保持历史 URL、canonical pathname、标题锚点、taxonomy、feed 和静态内容边界；空栏目入口由 `scripts/site-pages.mjs` 维护。
- 全站正文宽度以文章页为基准。Weekly 列表是宽布局例外：每页 40 期，桌面 4 列，并保留无 JavaScript 可访问的分页链接。
- 主题默认代码块已被本站 HeroUI Pro CodeBlock 替换，不得退回主题默认展示。
- 登录、AI 对话、个人内容、咨询、会员和账户操作统一进入右侧助手面板；评论与当前文章收藏保留在文章页。`/chat/`、`/me/` 和旧 Worker `/api/chat` 不属于兼容 URL。
- 助手只使用 Clerk + Convex Agent。AI Search 匿名搜索与登录后 AI 对话共用既有 `tcitry-blog-search` 及关联 Gateway `tcitry-blog-chat`；不得重新引入 Worker 聊天或检索桥。
- 评论使用 Convex，以 canonical pathname 关联文章。未登录只返回聚合数量；正文、回复、附件和个人状态必须在后端鉴权。历史 GitHub Discussions 在另行迁移前保持不变。
- 私人收藏、评论、咨询、附件和 AI 会话不得进入公开 AI Search 语料。
- 账户、评论、会员、AI 对话和权限细节见 `docs/member-services.md`；AI Search、Gateway、索引和同步见 `docs/ai-search.md`；演示与 MDX 约定见 `docs/demo-authoring.md`。

## 配置与发布

- Clerk development/production 和 Convex development/production 必须隔离；AI Search 与 Gateway 共用现有资源。前端和对应 Convex 使用同一个 AI Search public endpoint hostname。
- 真实配置只放 Git 忽略的本地 env 或平台设置；Git 只保留无真实值的 `.env.example`。提交前运行 `npm run check:public` 并人工检查 diff。
- 普通 `build` 生成 noindex 本地预览，不得发布到生产域名。生产发布流程、变量位置和内容更新触发以 `docs/continuous-deployment.md` 为准。
- 推送站点 `main` 会触发生产发布。仅在真实登录与权限链路、检查、测试、生产构建、产物验证和脱敏均完成后提交并推送；配置或验收缺失时保留本地改动。
- 生产发布使用独立检出、独立依赖和独立 `dist/`，固定已审查的内容提交。不得上传可能被并行任务改写的共享产物。
- 修改主题或渲染后运行项目定义的 check、test、build 和 verify；生产变更使用对应 production 验证。公开主题 CI 成功不代表博客已部署。

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
