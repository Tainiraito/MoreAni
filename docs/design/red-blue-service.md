# 红蓝合战阶段 4B：领域 Service 与 Fast State 生命周期

## 范围

阶段 4B 只实现后端领域层，不注册 HTTP Router、不修改前端、不实现 Score Suggestion，也不引入 WebSocket、SSE、Redis 或 Celery。

主要代码：

* `backend/services/red_blue.py`：领域 Service、Fast State、TTL/LRU 缓存、replay、RankingDelta 和 Full Ranker coordinator；
* `backend/models.py`：用户 comparison watermark 和 Model Run 输入状态字段；
* `backend/main.py`：`0010-red-blue-realtime-state` 幂等迁移；
* `backend/tests/test_red_blue_service.py`：服务生命周期、幂等、并发和竞态测试。

## 事实与缓存

事实数据仍然是：

* `red_blue_comparisons`；
* `Rating`、`RatingRevision`；
* `red_blue_user_states` 中的 comparison 状态版本。

`PreferenceModelRun` / `PreferenceResult` 是可重建的权威 Full Snapshot。`RuntimeFastState` 和其内部的阶段 4A `FastPreferenceState` 只存在进程内，删除、TTL 过期或进程重启都不会丢事实。

## Watermark

`red_blue_user_states`：

| 字段 | 语义 |
| --- | --- |
| `user_id` | 用户主键 / 外键 |
| `comparison_state_version` | 每次新增 Comparison 递增，包括 SKIP；revoke 也递增 |
| `revoke_version` | revoke 已存在 Comparison 时递增 |
| `updated_at` | 最近状态版本修改时间 |

`preference_model_runs` 现在同时保存：

* `input_comparison_max_id`：replay 的事实边界；
* `input_comparison_state_version`：运行读取到的整体 comparison 状态；
* `input_revoke_version`：运行读取到的 revoke 状态；
* `input_rating_revision_max_id`：Score Anchor watermark；
* `algorithm_version`；
* `algorithm_config_json`。

算法配置使用 canonical JSON 的 SHA-256 fingerprint 比较，不能只比较版本字符串。

## Fast State 结构

`RuntimeFastState` 包含：

* `user_id`；
* `base_model_run_id`；
* `base_comparison_max_id`；
* `comparison_state_version` / `revoke_version`；
* `anchor_revision_max_id`；
* `algorithm_version` / `algorithm_config_fingerprint`；
* 当前候选 ID 集合；
* `last_applied_comparison_id`；
* `fast_updates_since_full`；
* 阶段 4A 的纯算法 state；
* `freshness` 和 `requires_full_ranker`。

单项状态同时保留最新 Fast mean / provisional rank / comparison count，以及最近 Full Snapshot 的 expected rank、rank interval 和 stability。Fast `preference_std` 只有在算法实际更新后才使用局部 Laplace 值；Selector 的权威区间和 stability 仍来自 Full Snapshot。

## Cache

`RedBlueFastStateCache` 是：

* key = `user_id`；
* `OrderedDict` 实现 LRU；
* TTL 默认 900 秒；
* 默认最多 128 个用户；
* 所有参数可通过 `RedBlueServiceConfig` 或环境变量调整；
* 每用户独立 `RLock`；
* 过期 / eviction / clear 只删除运行时缓存。

服务默认使用 `ThreadPoolExecutor(max_workers=1)` 执行 Full Ranker。线程中始终创建自己的 SQLAlchemy Session，不跨线程传递请求 Session。

## Cache miss / replay

重建顺序：

1. 读取当前候选池：`anime` / `anime_movie`、当前用户 `Rating.score > 0`、公开、未软删除；
2. 读取当前 Score Anchor 和全部轻量 watermark；
3. 查找最近 `COMPLETED` 且 algorithm、config、anchor、revoke、candidate IDs 兼容的 Full Snapshot；
4. 若存在，读取 Snapshot 边界以前的 comparison，构造 Base Fast State；
5. 查询 `input_comparison_max_id` 之后的 comparison，按 ID 顺序 replay；
6. SKIP 只进入 Selector history，不改变 Fast Rank；
7. LEFT / RIGHT / TIE 调用阶段 4A 两作品 Davidson/Laplace Update；
8. 最后原子替换缓存。

如果没有 Full Snapshot，使用 Ranker 的 `build_score_priors()` 建立 BOOTSTRAP 排名，稳定性为 `UNCALIBRATED`，并标记 `requires_full_ranker`。这样首次进入不必等待完整 Ranker 才能展示基础排序和选择下一 Pair。

## Freshness

| 状态 | 语义 |
| --- | --- |
| `FULL` | 当前状态与最近兼容 Full Snapshot 一致 |
| `FAST` | Full Snapshot 后只有可 replay 的普通 Comparison / SKIP |
| `BOOTSTRAP` | 没有可用 Full Snapshot，只有 Score Prior 临时排序 |
| `STALE_REQUIRES_FULL` | Anchor、revoke、候选集合、算法配置或状态年龄不兼容 |

以下事件不走普通 Fast replay：

* Score Anchor watermark 改变；
* revoke version 改变；
* 候选 ID 集合改变；
* algorithm version / config fingerprint 改变；
* Fast State 年龄或更新次数超过配置阈值。

其中 Anchor、candidate、revoke、config 变化会立即使缓存不可兼容。revoke 不尝试逆向 Fast Update。

## Comparison 事务边界

`record_comparison()` 的边界是：

1. 获取当前用户 lock；
2. 先检查 `(user_id, client_event_id)`；
3. 校验候选池和左右方向；
4. INSERT `red_blue_comparisons`；
5. 同一个数据库事务内递增 `comparison_state_version`，revoke 时额外递增 `revoke_version`；
6. COMMIT 事实；
7. COMMIT 之后 replay / Fast Update / ranking reorder / Selector；
8. 返回领域结果。

数据库唯一约束是幂等最后防线。并发 INSERT 冲突会 rollback 后读取已存在事实并按幂等成功返回，不会返回 500。数据库事实先于缓存，进程在 COMMIT 后崩溃时，下次 watermark 检查会 replay。

SKIP 仍然保存并递增 state version，但不增加 Fast update count、不修改 preference mean；它仍进入 Pair cooldown、skip cooldown 和 exposure history。

## Revoke

`revoke_comparison()` 只允许当前用户访问自己的 comparison：

* 首次 revoke 设置 `revoked_at`，递增两个版本，并提交；
* 立即删除 Fast Cache；
* 请求 Full Recalibration；
* 重复 revoke 不再次递增版本，按幂等成功返回。

## Full Recalibration

`run_full_recalibration(user_id, reason)` 的事务分为三段：

1. 短事务冻结候选、Anchor、有效事实和全部 watermark，创建 `RUNNING` Model Run；
2. 事务结束后运行纯 CPU Full Ranker；
3. 新短事务保存 `PreferenceResult` 并将 Model Run 标记 `COMPLETED`；失败则标记 `FAILED` 和 `error_message`。

Full 运行期间追加普通 Comparison / SKIP 不会使这次计算作废。完成后以冻结边界创建 Base Snapshot，再 replay 边界之后的新事实，最后 atomic swap Fast Cache。因此用户排名版本不会回滚。

如果运行期间发生 Anchor、revoke、候选集合或 config 变化，Snapshot 仍可作为历史 Model Run 保存，但不会替换当前 Fast Cache，并返回 `follow_up_required`。

同一用户通过 coordinator 去重：已有运行时只记录 pending reason，不启动第二个 Full Ranker。服务重启后，超过配置年龄的 `RUNNING` 会被标记为 `FAILED`，避免永久占用。

## 当前触发参数

阶段 4A 的合成实验显示，两作品 Fast Update 在 500 部候选约 5ms；连续 20 次后均值误差会累积，因此当前初始配置为：

* `max_fast_updates_before_full = 10`；
* `max_fast_state_age_seconds = 900`；
* 强制事件仍优先于次数阈值。

10 只是参数化的初始运行值，不是算法保证；阶段 4C/线上指标应根据 Full 对照误差继续调整。

## RankingDelta 与 Selector

Fast 更新后按 `preference_mean` 稳定排序，content ID 是确定性技术 tie-breaker，不代表产品层确定先后。`RankingDelta` 不只返回 A/B：凡是被挤动的中间作品都包含在内；A/B 即使名次不变也会包含。

Selector 只取最近配置窗口的 comparison history，不再每次读取用户全部历史。Selector 输入使用最新 Fast mean、provisional rank 和 comparison count，同时继承 Full Snapshot 的 uncertainty、interval 和 stability；没有 Snapshot 时使用 bootstrap 的 `UNCALIBRATED` 状态。

一次本机 SQLite 500 部 bootstrap 状态的完整普通 Comparison Service 链路（事实提交、watermark、Fast replay、稳定排序、RankingDelta、Selector）耗时约 `0.263s`，生成 30 条 delta 并返回下一 Pair。该数字包含本地数据库读写，不包含网络延迟；Full Snapshot 已存在时不需要 bootstrap 计算，阶段 4A 测得的 Fast Update 本身约 5ms。

## 阶段 4C API 建议

下一阶段 Router 可以直接映射领域对象，不应让 Pydantic schema 反向进入 Service。建议：

* `GET /api/v1/red-blue/state`：返回 `BattleState`；
* `POST /api/v1/red-blue/comparisons`：传入左右内容、outcome、client event，返回 `ComparisonResult`；
* `POST /api/v1/red-blue/comparisons/{id}/revoke`：仅管理员/后续明确权限边界使用；
* `GET /api/v1/red-blue/recalibration`：返回 freshness、是否需要 Full、是否运行中；
* `POST /api/v1/red-blue/recalibration`：只触发领域 coordinator，不在 Router 内直接运行 CPU Ranker。

V1 使用普通 HTTP 即可；实时排名由 comparison POST 响应返回，暂不需要 SSE 或 WebSocket。
