# 公开 URL 与历史兼容

公开 URL 是长期接口。移动内容目录或修改标题时，优先保留现有 canonical；新页面确定 slug 后保持稳定。内容目录、导航分类和公开地址可以分别维护。

## 发布门禁

构建输出 `route-history.json`，仅包含累计公开过的路径，不含内容源文件名、标题或私有提交信息。新内容在下一次发布时自动加入，无需修改内容仓或手工更新快照。

生产构建和 production 产物验证都读取 `https://yindongliang.com` 上一次发布的清单。首次启用时，若线上 release marker 尚未声明路由历史，则从线上 sitemap 建立基线。此后清单丢失、格式错误、网络失败或读取期间版本切换都会阻止构建，不能静默重建基线。`deploy:verified` 在后端发布前及 Worker 上传前还会复查线上清单；若构建后另一批内容引入了本产物未记录的 URL，必须重新构建。

本地 preview 优先使用现有 `dist/route-history.json`；第一次构建使用既有 Hugo 路由快照。离线 preview 的基线不等于已验证最新线上历史。发布封存会独立执行 production 验证，不能用本地基线代替。

历史地址必须继续成为 canonical、指向真实页面的一跳 301，或在 `scripts/route-migrations.json` 中明确退役。累计清单保留旧地址，因此删除迁移规则也会导致后续构建失败。标签、栏目和分页同样受保护；减少分页或删除最后一篇带某标签的文章时，也需处理对应历史入口。

## 明确迁移或退役

`route-migrations.json` 是需要 review 的站点配置，初始为空。仅在确实改变公开 URL 时添加记录，例如：

```json
{
  "version": 1,
  "redirects": {
    "/docs/old/": {
      "to": "/docs/Current/",
      "reason": "内容合并到 Current，已核对目标及评论关联"
    }
  },
  "retired": {
    "/removed/": {
      "status": 410,
      "reason": "已确认永久删除，且没有对应替代内容"
    }
  }
}
```

路径使用公开的百分号编码形式，不带域名、query 或 fragment。`redirects` 可以引用旧迁移目标，构建会压平为最终 canonical；目标不存在、循环、冲突或遮蔽当前 canonical 都会失败。显式迁移仅进入 Worker 精确查找表，不占静态 `_redirects` 配额。已有内容 aliases 同样解析到最终目标。

退役必须填写理由并选择 404 或 410，两种尾斜杠均直接返回该状态，不跳转到首页或父栏目。与自动大小写规则冲突、两种形态声明不同状态或使用保留的 `/api/*` 路径都会使构建失败。目前没有新增退役记录；已有未知路径仍按原规则返回 404。

评论以 canonical pathname 关联。301 不会迁移评论；保留原 canonical 可以避免评论断开。确需迁移时，应另行核对评论映射、权限和回滚，不把填写 URL 迁移记录视为写生产数据库的授权。

## 站内链接

finalize 阶段依据真实路由和显式 aliases，修正最终 HTML 的 anchor href，包括正文、导航和分页中的已知旧地址、大小写、尾斜杠和编码写法。query 与 fragment 保留；代码示例、脚本、模板和外部链接不改写。只有 href 属性会改变，不重新序列化整页 HTML，也不改写 Blog 源文件。

`verify` 随后检查全部 canonical 页面的最终 HTML，要求站内页面链接直接使用 canonical，并继续检查文件和目标锚点。不存在的路径或无法确认的大小写不会被猜测成某个页面，而是使验证失败。站点资产链接保持各自的文件地址。

当源内容仍引用旧地址时，构建会修正公开 HTML；长期应按独立内容任务修正源链接。此功能不自动编辑内容仓，也不自动移动文章或改变 canonical。

## 验证与线上效果

按 `package.json` 运行 `npm run check`、`npm test`、`npm run build` 和 `npm run verify`；生产发布仍须独立检出、production 构建和 release 封存。历史清单、退役状态和 Worker 映射均包含在 dist 资产哈希中，封存后改变任一文件都会使发布校验失败。

发布后使用既有 deployment verifier 检查 Worker 301 和显式退役状态。404 流量是否下降需结合线上请求、来源页和爬取结果确认；单纯构建通过不能证明外部错误链接已经消失。
