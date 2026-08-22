# MoreAni 公网安全基线

MoreAni 保持公开内容的匿名读取体验，但对认证、注册和写入操作使用更严格的保护。

## 限流基线

- 登录：单 IP 10 次/15 分钟；同一账号标识与 IP 失败 5 次后冻结 5 分钟。
- 注册：单 IP 5 次/小时。
- 写入：登录用户同时受用户 ID 和 IP 两个 30 次/分钟桶限制。
- 普通读取：单 IP 300 次/分钟。
- 本地封面和头像：单 IP 600 次/分钟。
- `OPTIONS` 预检和 `/api/health` 不消耗普通读取额度。

阈值可通过 `MOREANI_RATE_LIMIT_*`、`MOREANI_LOGIN_*` 环境变量调整。当前部署使用单个 Uvicorn worker，因为限流状态是进程内存，数据库为 SQLite；扩容到多进程或多副本时应改用共享存储。

## 代理与跨站请求

只有 `TRUSTED_PROXY_NETWORKS` 中的代理地址可以提供 `X-Forwarded-For` 或 `CF-Connecting-IP`。危险方法会校验 `Origin`，生产环境默认只允许 `https://moreani.lovelysia.top`。

## 安全响应头

应用和 Nginx 均发送 `nosniff`、`DENY`、严格 Referrer Policy、Permissions Policy 和 CSP。HSTS 只在 Cloudflare HTTPS 边缘配置，源站 HTTP 不强制发送。

## 明确接受的剩余风险

- 分享链接、游客会话和游客匿名化暂不实现。
- `/api/covers/{id}` 本地封面静态资源不按内容私有状态鉴权。
- 公开评分读取接口本轮不增加私有资源鉴权。

安全日志只记录规则、路由、状态、脱敏 IP 和匿名化标识，不记录密码、Cookie、Authorization 或请求体。
