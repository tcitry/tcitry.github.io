# 邮件通知（Resend）

本站 Phase 1 使用 [Resend](https://resend.com/docs) 发送自托管邮件通知。偏好设置保存在 Convex `emailPreferences` 表，是唯一事实来源。

## 默认与全局开关

- **用户默认全部关闭**：总开关 `enabled` 与所有类别（`commentReply`、`likes`、`newComment`、`newsletter`）初始均为 `false`。用户必须在助手「我的 → 邮件通知」中主动开启才会收到邮件。
- **全局发信开关**：Convex 环境变量 `EMAIL_SENDING_ENABLED`。未设置或非 `true`/`1`/`yes` 时，**即使已配置 `RESEND_API_KEY` 也不会发送任何邮件**。站主在确认 Resend、域名与偏好流程就绪后，再在生产部署中显式开启。

## 功能范围（Phase 1）

- 评论回复邮件（`commentReply`）
- 用户可在助手「我的 → 邮件通知」管理偏好
- 无需登录的退订页：`/email/unsubscribe/?token=...`
- RFC 8058 一键退订：`POST` 到 Convex HTTP `/email/unsubscribe`
- Resend Webhook：硬退信 / 投诉自动停用该邮箱

尚未发送但已存储的类别开关：`likes`、`newComment`、`newsletter`。

## Resend 配置步骤

### 1. 域名与 DNS

1. 在 Resend 控制台添加发送域名（建议 `notify.yindongliang.com`）。
2. 按 Resend 提示添加 SPF、DKIM、DMARC 等 DNS 记录。
3. 等待验证通过后再发送生产邮件。

### 2. API Key 与环境变量

1. 在 Resend 创建 API Key（仅服务端使用）。
2. 写入 **Convex 部署环境变量**（development / production 分别配置）：

| 变量 | 说明 |
| --- | --- |
| `RESEND_API_KEY` | Resend API Key |
| `RESEND_WEBHOOK_SECRET` | Webhook 签名密钥（`whsec_...`） |
| `EMAIL_FROM` | 发件人，默认 `尹东亮的博客 <notify@notify.yindongliang.com>` |
| `SITE_URL` | 站点 URL，默认 `https://yindongliang.com` |
| `EMAIL_SENDING_ENABLED` | 全局发信开关；设为 `true` 后才实际调用 Resend（默认关闭） |

未配置 `RESEND_API_KEY` 或 `EMAIL_SENDING_ENABLED` 未开启时，评论与站内通知功能正常，仅跳过发信并写入 `emailSendLog`（原因分别为 `resend_not_configured`、`sending_disabled`）。

### 3. Webhook

1. 在 Resend Webhooks 添加 endpoint：`https://<deployment>.convex.site/resend/webhook`
2. 订阅至少：`email.bounced`、`email.complained`
3. 将 Signing Secret 设为 Convex 的 `RESEND_WEBHOOK_SECRET`

### 4. Clerk 邮箱

邮件只发往 Clerk 会话中 **已验证** 的主邮箱（`email` + `emailVerified`）。用户评论或打开邮件设置时会缓存到 `emailPreferences.cachedEmail`。

### 5. 上线顺序建议

1. 配置 DNS 与 `RESEND_API_KEY`、`RESEND_WEBHOOK_SECRET`、`EMAIL_FROM`、`SITE_URL`
2. 部署代码，确认用户可在设置面板中 opt-in
3. 小流量验证后，将 `EMAIL_SENDING_ENABLED=true` 写入生产 Convex 部署

## 本地开发

- 不要在 Git 中提交真实密钥；参考 `.env.example` 与 Convex Dashboard。
- 运行 Convex 测试：`npm run test:reader`（包含 `convex/emailNotifications.test.ts`）。
- 退订页路由：`src/pages/email/unsubscribe.astro`。

## 相关代码

- Schema：`convex/schema.ts`（`emailPreferences`、`emailSendLog`、`emailThreadThrottle`）
- 偏好：`convex/emailPreferences.ts`
- 发信：`convex/emailNotifications.ts`
- HTTP：`convex/http.ts`（webhook、一键退订）
- UI：`src/components/reader/EmailSettingsPanel.tsx`、`src/components/email/EmailUnsubscribe.tsx`
