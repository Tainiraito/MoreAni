# 红蓝合战阶段 4C：HTTP API 契约

阶段 4C 只把阶段 4B 的 `RedBlueService` 暴露为普通 HTTP API；阶段 7 在不改变事实模型的前提下，为连续 PK 增加了临时 Focus 上下文字段。

## Endpoint

基础路径为 `/api/v1/red-blue`，所有 endpoint 都通过当前登录用户的 cookie 认证：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/state` | 获取可完整恢复页面的当前状态 |
| `POST` | `/comparisons` | 写入一条 PK 事实并返回增量 |
| `POST` | `/comparisons/{comparison_id}/revoke` | 撤销当前用户自己的 PK 事实 |

本阶段不暴露 `/recalibration`。Full Ranker 由 Service 自动调度；这样普通页面不依赖运维 endpoint，也不会把内部调度操作开放给普通用户。

所有数据的 `user_id` 都来自认证 cookie，客户端不能通过 query、path 或 body 指定用户。

## GET `/state`

响应结构：

```json
{
  "state_version": 3,
  "model_freshness": "FAST",
  "candidate_count": 120,
  "pair_status": "AVAILABLE",
  "current_pair": {
    "left": {"content_id": 101, "title": "番剧 A", "cover_url": null, "content_type": "anime"},
    "right": {"content_id": 202, "title": "番剧 B", "cover_url": null, "content_type": "anime"},
    "selector_version": "selector-v1",
    "selection_reason": "UNCERTAIN_PAIR"
  },
  "ranking": [],
  "full_recalibration_required": false,
  "full_recalibration_running": false
}
```

`current_pair` 和 ranking 行都只返回轻量作品摘要：`content_id`、`title`、`cover_url`、`content_type`。不会重复返回简介、tags、评论或完整 Content Detail；PK Pair 默认不返回当前评分。

Ranking 行还包含：

- `rank`：`FULL` 时使用最近 Full Snapshot 的权威 `expected_rank`；`FAST`、`BOOTSTRAP` 和需要 Full 的临时状态使用实时 `provisional_rank`。
- `current_score`：MoreAni 当前 `Rating.score`，不是 Ranker 的输入锚点。
- `preference_mean`、`comparison_count`。
- `rank_low`、`rank_high`、`stability`：来自最近一次 Full Snapshot 的权威不确定性；Fast Update 不伪造新的 uncertainty。

`state_version` 就是当前用户的 `comparison_state_version`。新增任何 Comparison（包括 `SKIP`）递增一次；revoke 也递增一次；幂等重放和重复 revoke 不递增。客户端可以用它丢弃迟到的旧响应。

`pair_status` 为 `AVAILABLE`、`INSUFFICIENT_CANDIDATES` 或 `COOLDOWN`。因此 0/1 部候选和暂时没有可用 Pair 都是成功响应，而不是 500：

- 0 部：`candidate_count=0`、`current_pair=null`、`ranking=[]`。
- 1 部：`current_pair=null`、`ranking` 含 1 行、`INSUFFICIENT_CANDIDATES`。
- 至少 2 部但 Selector 暂时没有可用 Pair：`current_pair=null`、`COOLDOWN`。

## POST `/comparisons`

请求：

```json
{
  "left_content_id": 101,
  "right_content_id": 202,
  "outcome": "LEFT_WIN",
  "client_event_id": "550e8400-e29b-41d4-a716-446655440000",
  "focus_content_id": 101
}
```

`client_event_id` 是必填 UUID，必须由客户端生成；服务端不会偷偷补一个新的幂等键。`outcome` 只能是 `LEFT_WIN`、`RIGHT_WIN`、`TIE`、`SKIP`。

`focus_content_id` 可选，只作为本次响应选择 `next_pair` 的临时 `SelectorContext`。它不写入 `red_blue_comparisons`、`red_blue_user_states` 或 React Query 的 ranking 事实缓存；刷新页面后 Focus 由前端 UI 状态自然清除。Selector 会按配置提高包含该作品的 Pair 概率，但不保证每一组都包含它。

成功响应返回：

- 已落库的 `comparison` 事实；
- 新的 `state_version`；
- `ranking_delta`，包含所有被挤动的行，而不只是左右两部作品；
- `next_pair` 和 `pair_status`；
- `model_freshness`、`full_recalibration_required`、`full_recalibration_running`；
- `idempotent_replay`。

正常连续 PK 不返回完整排行榜。客户端通过 delta patch 排名，需要完整恢复时重新调用 `GET /state`。

相同用户、相同 `client_event_id` 的行为：

| 情况 | 结果 |
| --- | --- |
| payload 完全相同 | `200`，`idempotent_replay=true`，不新增事实、不推进版本 |
| left/right、outcome 或 selector payload 不同 | `409`，不会静默返回第一次结果 |

两个不同 event ID 即使是同一 Pair，也都是允许保存的真实事实；重复 Pair 控制只属于 Selector。

## POST `/comparisons/{id}/revoke`

revoke 是逻辑撤销，不物理删除事实。成功响应返回已撤销的 comparison、新 `state_version`、当前 `model_freshness` 以及 Full 调度状态，但不伪造尚未完成的全量排名。revoke 后 Fast State 失效并强制请求 Full Ranker。

- 只能撤销当前用户自己的 comparison。
- 已撤销再次调用返回 `200`，不再次递增版本。
- 不存在或属于其他用户统一返回 `404`，不泄露资源是否存在。

## 错误和认证

- `400`：非法 outcome、左右相同、作品不在当前候选池等业务输入错误。
- `401`：未登录。
- `404`：当前用户看不到目标 comparison。
- `409`：幂等键已绑定不同事实 payload，或状态在并发变化中已经不再适用。
- `422`：FastAPI/Pydantic 请求结构、UUID、正数 ID 等校验失败。
- `429`：专用 PK 限流或其他限流规则触发。

## 专用限流

`POST /api/v1/red-blue/comparisons` 使用独立滑动窗口，默认 `120 次/60 秒`，同时保留 IP bucket 和已认证用户 bucket；revoke 仍走通用写请求规则。参数可由以下环境变量调整：

- `MOREANI_RATE_LIMIT_RED_BLUE_COMPARISON`
- `MOREANI_RATE_LIMIT_RED_BLUE_COMPARISON_WINDOW_SECONDS`

120/min 是阶段 4C 的初始工程配置：它高于当前通用写请求 30/min，能覆盖正常连续点击，同时仍然限制无限循环请求。它不是算法或用户行为实验得出的最优值，后续应结合生产点击分布、SQLite 写入延迟和 Full 调度压力再调参。

## Freshness 和恢复流程

V1 不使用 WebSocket/SSE。每次 POST 和 GET 都读取当前可用 Fast State；Full Ranker 在后台完成后，下一次 GET 或 POST 自然获得新 Snapshot。用户停止操作期间页面不会主动收到推送，这是 V1 的已知限制。

未来前端调用流程：

```text
进入页面
  -> GET /state
  -> 渲染 current_pair + 完整 ranking
选择结果
  -> 客户端生成 UUID client_event_id
  -> POST /comparisons
  -> 立即显示 next_pair
  -> 用 ranking_delta patch 排名
  -> 比较 state_version，丢弃迟到旧响应
版本不连续或本地状态异常
  -> GET /state 完整恢复
```

API 不提前返回 Score Suggestion 字段；后续评分校准阶段通过向后兼容字段扩展。

## OpenAPI 与性能实测

Request/Response 全部使用明确的 Pydantic model，FastAPI OpenAPI 会暴露 `CreateComparisonRequest`、`CreateComparisonResponse`、`RedBlueStateResponse`、`RedBluePairResponse`、`RedBlueRankingItemResponse` 和 `RevokeComparisonResponse` 等 schema。

开发环境修改后必须重启 backend；不能只依赖源码或测试进程已经更新。启动后以当前运行实例的 `/openapi.json` 作为真实 HTTP 契约校验依据，并确认 `CreateComparisonResponse.properties.score_suggestion_delta` 存在。前端仍保留对旧开发进程缺失该字段的兼容处理，缺失时按空增量处理。

本地 SQLite、当前测试数据和 Python TestClient 实测如下。数值用于工程基线，不是跨机器 SLA：

| ranking 条数 | GET state 端到端耗时 | 响应体 |
| ---: | ---: | ---: |
| 50 | 约 0.069s | 12,589 bytes |
| 100 | 约 0.286s | 24,772 bytes |
| 500 | 约 0.347s | 123,819 bytes |
| 1000 | 约 0.668s | 247,549 bytes |

500 部候选的一次普通 Comparison HTTP 链路实测：

- GET state 选择初始 Pair：约 0.319s；
- POST comparison，从 Router、Service、事务提交、Fast Update、RankingDelta、Selector 到 Pydantic/JSON 响应：约 0.295s；
- POST 响应体：约 4,435 bytes。

这些测试覆盖了 50/100/500/1000 state、500 部 comparison、幂等、冲突、认证、隔离、四种 outcome、revoke、cooldown、限流和并发。

## 阶段 4B 参数说明

`max_fast_updates_before_full=10` 保持阶段 4B 的初始实验配置。阶段 4A 已验证 Fast 路径的速度和局部近似策略，但当前资料没有证明 10 是全局最优阈值；本阶段不重新做大规模算法实验，明确将其视为需要后续调参的临时工程参数。
