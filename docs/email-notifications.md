# 邮件通知（Resend）

本站 Phase 1 使用 [Resend](https://resend.com/docs) 发送自托管邮件通知。偏好设置保存在 Convex `emailPreferences` 表，是唯一事实来源。

## 默认策略

- **用户默认全部关闭**：总开关 `enabled` 与所有类别（`commentReply`、`likes`、`newComment`、`newsletter`）初始均为 `false`。用户必须在助手「我的 → 邮件通知」中主动开启才会收到邮件。

## 功能范围（Phase 1）

- 评论回复邮件（`commentReply`）
- 用户可在助手「我的 → 邮件通知」管理偏好
- 无需登录的退订页：`/email/unsubscribe/?token=...`
- RFC 8058 一键退订：`POST` 到 Convex HTTP `/email/unsubscribe`
- Resend Webhook：硬退信 / 投诉自动停用该邮箱

尚未发送但已存储的类别开关：`likes`、`newComment`。

`newsletter` 用于 Resend Audience 手动群发（Broadcasts），见下文「手动群发」。

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
| `RESEND_AUDIENCE_ID` | Newsletter Audience / Segment ID（手动群发联系人同步） |
| `EMAIL_FROM` | 事务邮件发件人，默认 `LYon's blog <notify@notify.yindongliang.com>` |
| `EMAIL_NEWSLETTER_FROM` | Broadcast 建议发件人（仅文档/运营参考），建议 `LYon's blog <newsletter@notify.yindongliang.com>` |
| `SITE_URL` | 站点 URL，默认 `https://yindongliang.com` |

未配置 `RESEND_API_KEY` 时，评论与站内通知功能正常，仅跳过发信并写入 `emailSendLog`（`resend_not_configured`）。未配置 `RESEND_AUDIENCE_ID` 时，Newsletter Audience 同步安全跳过。

### 3. Webhook

1. 在 Resend Webhooks 添加 endpoint：`https://<deployment>.convex.site/resend/webhook`
2. 订阅至少：`email.bounced`、`email.complained`、`contact.updated`
3. 将 Signing Secret 设为 Convex 的 `RESEND_WEBHOOK_SECRET`

`contact.updated` 用于 Broadcast 退订回写 Convex（`newsletter=false`）。本站向 Resend 推送的订阅变更在短窗口内忽略回写，避免同步环路。

### 4. Clerk 邮箱

邮件只发往 Clerk 会话中 **已验证** 的主邮箱（`email` + `emailVerified`）。用户评论或打开邮件设置时会缓存到 `emailPreferences.cachedEmail`。

## 本地开发

- 不要在 Git 中提交真实密钥；参考 `.env.example` 与 Convex Dashboard。
- 运行 Convex 测试：`npm run test:reader`（包含 `convex/emailNotifications.test.ts`）。
- 退订页路由：`src/pages/email/unsubscribe.astro`。

## 手动群发（Newsletter / Broadcasts）

站主在 Resend 控制台通过 **Broadcasts** 向 Audience 手动发送产品动态、新文章等邮件。Convex 是唯一订阅事实来源；仅当用户 **有效订阅**（`enabled && newsletter && 已验证邮箱 && 未 emailDisabled`）时，才会同步到 Resend Audience。

### 环境变量

除上文 Resend 变量外，在 Convex 部署中设置：

| 变量 | 说明 |
| --- | --- |
| `RESEND_AUDIENCE_ID` | Resend Audience（Segment）ID |
| `EMAIL_NEWSLETTER_FROM` | 建议 Broadcast 发件地址，如 `newsletter@notify.yindongliang.com`（需在 Resend 域名下验证；代码中仅作文档提示，实际在控制台创建 Broadcast 时填写） |

`RESEND_API_KEY` 与 `RESEND_AUDIENCE_ID` 任一缺失时，Audience 同步自动 no-op，不影响站内其他邮件。

### 创建 Audience

1. 在 Resend **Audiences**（或 Segments）新建列表，例如「博客 Newsletter」。
2. 复制 Audience / Segment ID，写入 Convex `RESEND_AUDIENCE_ID`。
3. 无需手工导入联系人：用户在本站助手「我的 → 邮件通知」开启 Newsletter 后，Convex 会通过 Contacts API 自动 upsert 并加入该 Audience。

### 发送 Broadcast

1. 在 Resend 选择 **Broadcasts → Create**，收件人选择上述 Audience。
2. **发件人**建议使用 `EMAIL_NEWSLETTER_FROM`（如 `newsletter@notify.yindongliang.com`），与事务通知 `notify@` 区分。
3. 撰写主题与正文后发送或定时发送。
4. 仅会向 Audience 中 **未 unsubscribed** 的联系人投递；Audience 成员应全部来自本站 opt-in 同步。

### 退订与同步

- 用户在 Broadcast 邮件中退订 → Resend 触发 `contact.updated`（`unsubscribed: true`）→ Convex 将 `newsletter` 设为 `false`。
- 用户在本站关闭 Newsletter / 总开关 / 退订页 / 一键退订 / 硬退信或投诉 → Convex 调度内部 action，在 Resend 将联系人标为 unsubscribed。
- 全量对账（站主一次性）：`npx convex run emailNewsletter:reconcileNewsletterAudience`

## 相关代码

- Schema：`convex/schema.ts`（`emailPreferences`、`emailSendLog`、`emailThreadThrottle`）
- 偏好：`convex/emailPreferences.ts`
- 发信：`convex/emailNotifications.ts`
- Newsletter Audience：`convex/emailNewsletter.ts`
- HTTP：`convex/http.ts`（webhook、一键退订）
- UI：`src/components/reader/EmailSettingsPanel.tsx`、`src/components/email/EmailUnsubscribe.tsx`
