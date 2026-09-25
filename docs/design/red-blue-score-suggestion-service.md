# 红蓝合战阶段 5.1：评分建议 Service 与闭环

> 本文记录阶段 5.1 的建议持久化和动作事实；当前 UI 入口、展示语义与完整数据流见[阶段 8 综合设计](red-blue-battle.md)。

阶段 5.1 在阶段 5 的纯校准算法之外增加持久化编排和用户动作闭环，不修改前端。

## 事实与缓存

`score_suggestion_actions` 是用户对建议执行 `ACCEPTED`、`DISMISSED`、`REJECTED` 的权威事实。`score_suggestions.status` 只是当前模型运行的派生展示缓存；重算或删除建议时，Action 仍可通过 `suggestion_key`、`client_event_id`、比较状态 watermark 和有效 comparison watermark 恢复。

Action 还保存 `comparison_state_version_at_action` 与 `effective_comparison_max_id_at_action`。后者排除 `SKIP` 和 revoked comparison，用于判断 DISMISSED 是否遇到新的有效 PK 证据；SKIP 只推进状态版本，不解除暂时忽略。

## 建议刷新

`ScoreSuggestionService.refresh_score_suggestions()` 读取当前 Fast preference mean、最近 Full uncertainty、Rating 当前分和 Score Anchor，调用纯 `generate_score_calibrations()`，再按 `(user_id, content_id, suggestion_key)` reconciliation：

* 新建议写入 PENDING；
* 同 key 的派生字段更新；
* 不再属于当前 Top N 的旧 PENDING 标记 EXPIRED；
* `max_suggestions` 之外的预测不写入缓存；
* STALE / BOOTSTRAP 不生成新建议，并将旧 PENDING 过期；
* 校准异常只记录日志并返回空 delta，不影响已提交 Comparison 或已完成 Model Run。

数据库唯一语义同时包含 `model_run_id` 和 `suggestion_key`。这样同一 Full run 后续的 FAST evidence 可以让 `8.0→8.5` 过期并产生新的 `8.0→9.0`，不会被旧的 `(model_run, user, content)` 唯一约束挡住；旧 SQLite 数据由 `0012-red-blue-score-suggestion-key-uniqueness` 重建表结构兼容迁移。

建议展示在 `GET /api/v1/red-blue/state` 的对应 ranking 行 `score_suggestion`；普通 PK 的响应通过 `score_suggestion_delta` 返回新增、更新和移除。

## 用户动作

```text
POST /api/v1/red-blue/score-suggestions/{suggestion_id}/actions
{
  "action": "ACCEPTED | DISMISSED | REJECTED",
  "suggestion_key": "...",
  "client_event_id": "uuid"
}
```

同一用户和 `client_event_id` 的相同 payload 幂等返回；不同 payload 返回 409。建议 key、PENDING 状态或当前 `Rating.score` 不匹配也返回 409。

`ACCEPTED` 在一个事务内完成：写 Action、通过既有 `rating.upsert_rating()` 写入 `Rating.score`、保留 `Rating.score_anchor`、写 `RatingRevision(source='pk_suggestion')` 并关联 suggestion/action、最后更新 suggestion 状态。该过程不触发 Full Ranker；由于 anchor watermark 不变，后续 PK 模型不会把这次建议再次当作独立评分信号。

`DISMISSED` 和 `REJECTED` 不修改评分。`REJECTED` 对相同 suggestion key 永久抑制；`DISMISSED` 按时间或新的有效 comparison evidence 抑制；`ACCEPTED` 通过 Action 事实抑制同 key，当前评分已经等于建议时也不会重复生成。

## Freshness

* `BOOTSTRAP`：只展示 Score Prior 排名，不产生建议；
* `FAST`：使用 Fast mean、最近 Full interval/stability，并使用更严格置信阈值；
* `FULL`：使用完整权威结果；
* `STALE_REQUIRES_FULL`：不产生新建议，过期旧 PENDING。

V1 继续使用普通 HTTP；Comparison POST 已经包含当前排名增量和建议增量，GET state 可完整恢复，未引入 SSE/WebSocket。
