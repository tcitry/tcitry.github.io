# Astro 本地运行与验收

本文只描述本地开发和预览。生产发布见 [构建与发布](continuous-deployment.md)，命令定义以 `package.json` 为准。

## 初次运行

```sh
npm run setup
npm run dev
```

`setup` 使用 lockfile 安装准确依赖。`dev` 准备只读 Blog 内容和公开资源后启动 Astro。内容目录通过 `BLOG_DIR` 指定；不要在站点流程中修改它。

本地开发使用 `.env.local` 中的 development Clerk、Convex 和 AI Search 公共配置。该文件被 Git 忽略；可提交字段名和说明只维护在 `.env.example`。

## 构建预览

```sh
npm run build
npm run preview
```

普通构建生成 noindex 预览产物，只用于本地检查，不得发布到生产域名。`preview` 展示已经生成的 `dist/`，不会重新选择后端或重新构建内容。

需要完整本地回归时运行：

```sh
npm run check:local
npm run test:browser
```

根据改动范围还可运行 `package.json` 中更具体的浏览器目标。测试使用 fixture 时只证明组件行为；登录、权限、AI Search 和生产配置仍需真实环境验收。

## 验收重点

- 历史 URL、canonical、标题锚点、taxonomy、RSS、sitemap 和 404 保持兼容。
- 首页、文章、Docs、Weekly、Tags、Categories、Archives、Timeline、Portfolio、Links 和 demo 均能生成。
- 桌面与移动端没有横向溢出；正文宽度、侧栏、TOC、助手面板和浮层行为符合约定。
- 浅色、深色和跟随系统模式可用；键盘、焦点返回、Esc 和无 JavaScript 导航保持可访问。
- 代码块、Mermaid、KaTeX、表格、图片、iframe 与多框架 demo 使用真实内容样本检查。
- 匿名页面不读取私人 Convex 数据；切换 Clerk 账户后不显示上一账户缓存。
- AI Search 暂时不可用时正文仍可阅读，匿名搜索按设计回退，AI 对话显示可恢复错误。
- `dist/` 不包含本地路径、私有内容、secret、源映射残留或可下载的完整 AI 语料。

## 内容与主题边界

- Blog 仓库：公开文章、frontmatter、附件和文章内 demo 来源。
- `@tcitry/astro-book`：通用 Book 布局和主题能力。
- `tcitry-blog/src`：本站页面、业务组件、HeroUI Pro 集成及主题覆写。
- `.generated/` 与 `dist/`：生成结果，不作为源码维护。

主题改动先在独立主题仓库发布准确 npm 版本，再更新本站依赖和 lockfile。不要复制主题实现到本站绕过包边界。
