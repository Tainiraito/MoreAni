# 红蓝合战阶段 4A：实时排名快速路径技术验证

## 结论

阶段 4A 验证了三种来自现有 Davidson / Bayesian Ranker 的快速路径：

| 方案 | 核心做法 | 500 部单次更新 | 单次均值误差（本次合成基准） | 结论 |
| --- | --- | ---: | ---: | --- |
| A Warm-start MAP | 全候选 MAP 从上一结果开始，跳过 covariance / sampling | 约 3.80s | 近 0 | 不能作为实时路径 |
| B 两作品局部 Laplace | 只在 A/B 当前边际 posterior 上加入 Davidson 增量 | 约 0.005s | 约 0.0028 | 推荐 V1 默认 |
| C 局部邻域 MAP | 对排名邻域 + comparison 图 active set 重算 MAP | 约 0.209s | 约 0.0008 | 精度好，作为实验/可选增强 |

当前完整 Ranker 的同一批 500 部基准约 15.49s，其中包含 MAP、完整 covariance 和 posterior sampling；机器、NumPy BLAS、候选图和配置都会影响绝对耗时，以上数字用于路径量级和相对关系判断。

推荐阶段 4B 采用：

1. 普通 LEFT / RIGHT / TIE 先走 B，立即生成 `FastPreferenceState`；
2. 以连续 PK 次数、均值误差代理或后台 Full Ranker 完成结果作为校准边界；
3. Full Ranker 仍是唯一权威的 `rank_low`、`rank_high`、`stability` 和最终结果来源；
4. Score Anchor 变化、新作品加入、comparison revoke、算法配置变化直接触发 Full Ranker，不做错误的逆更新。

## 纯算法接口

实现位于 `backend/services/red_blue_fast_ranker.py`，不依赖 SQLAlchemy、FastAPI、HTTP 或任务队列。

核心对象：

* `FastPreferenceState`：候选、Score Anchor、从最近权威快照之后收到的 comparisons、权威结果和最新 fast results；
* `FastPreferenceResult`：`content_id`、`preference_mean`、可选 `preference_std`、`provisional_rank`、comparison count 和内部 `provisional` 标记；
* `FastUpdateOutput`：新的 state、结果、Selector 混合输入和时间分解；
* `FastUpdateStrategy`：`WARM_START_MAP`、`LOCAL_LAPLACE`、`LOCAL_NEIGHBORHOOD_MAP`。

Fast State 目前只在内存中验证，不增加表、不增加 migration，也不决定阶段 4B 的缓存或持久化方案。

## Davidson 增量语义

三分类 likelihood 仍使用当前 Ranker 的 Davidson 定义：

```text
logit(A 胜) = theta_A
logit(B 胜) = theta_B
logit(平局) = (theta_A + theta_B) / 2 + log(tie_strength)
```

因此：

* LEFT_WIN 会按照当前概率和当前 posterior uncertainty 改变 A/B，绝不是固定 `+K/-K`；
* RIGHT_WIN 对称处理；
* TIE 会把 `theta_A - theta_B` 向 0 推近，幅度由 Davidson likelihood 和边际方差决定；
* 同一 pair 的第 `n+1` 条记录不会永久获得全权重。

Ranker 的重复 pair 总权重为：

```text
W(n) = min(cap, max(1, n ** exponent))
```

局部路径使用真实目标函数增量：旧 pair 观测的每条权重从 `W(n)/n` 调整为 `W(n+1)/(n+1)`，新观测使用 `W(n+1)/(n+1)`。因此从 4 条增加到第 5 条时，新增总有效权重为 `sqrt(5) - sqrt(4)`，而不是 1.0。

## 三种方案

### A：Warm-start MAP

用当前 Fast State 的全量 mean 作为完整候选 MAP 的初值，使用 Ranker 相同的 score-anchor prior、comparison 过滤、重复 pair 权重和 Davidson Hessian。这里只运行有限次 Newton，不计算 covariance 和 sampling，输出沿用此前标准差。

它的优点是目标函数与 Full Ranker 最接近；缺点是 500 维 Hessian 的 dense solve 仍然是主要成本。实验中 500 部约 3.80 秒，因此不能承担点击后的实时响应。

### B：两作品局部 Bayesian / Laplace

把 A/B 当前 `preference_mean` 和 `preference_std` 作为二维 Gaussian marginal prior，仅对新增 comparison 的 Davidson log-likelihood 增量做 Newton / Laplace。V1 使用现有 `PreferenceResult` 能提供的边际方差；当前数据模型没有暴露完整 covariance，因此不虚构 A/B 相关项。

它的优点是 active dimension 始终为 2，速度基本不随候选数量增长；缺点是忽略了完整 posterior 中 A/B 与邻近作品的相关性，连续很多次后误差会累积。

### C：局部邻域 MAP

以本次 A/B 为中心，取当前 provisional rank 邻域和 comparison 图的直接邻居，形成 active set。active set 内使用 Score Anchor prior 和当前全部 comparison 做 Davidson MAP；active set 外固定为当前 Fast State 的 latent value。active set 上计算局部 Laplace 标准差，外部作品沿用已有 fast 标准差。

active set 不是写死的产品 K：实现通过 `FastUpdateConfig` 的 rank window、图邻居数和上限进行实验调节。它比 B 更能吸收局部图结构，均值误差较小，但 active set 和历史 comparison 增长后成本接近 Selector 甚至更高。

## 真实基准

单次更新使用相同的链式 history、Score Anchor、`posterior_sample_count=16` 和普通 `LEFT_WIN(1, N)`，以下是一次本机运行的分解。`total` 是包含排序和 Selector 转换的 wall time。

### 500 部三方案

```text
warm_start_map       active=500  update=3.7989s  reorder=0.0017s selector=0.0013s total=3.8021s
local_laplace        active=2    update=0.0017s  reorder=0.0017s selector=0.0012s total=0.0052s
local_neighborhood   active=29   update=0.2069s  reorder=0.0013s selector=0.0008s total=0.2092s
```

### 推荐 B 的候选规模

```text
candidates  update    reorder   selector  total
50          0.0008s   0.0002s   0.0001s   0.0011s
100         0.0015s   0.0004s   0.0003s   0.0022s
500         0.0017s   0.0017s   0.0012s   0.0052s
```

这是算法纯内存路径，不包含未来数据库写入、锁、队列或网络耗时；阶段 4B 仍需单独测量端到端延迟。

## 与 Full Ranker 的准确性

比较方式是：从同一个权威 State T 出发，加入同一条 comparison，同时运行 Fast Update 和包含全部 history + 新 comparison 的 Full Ranker；比较所有共同作品的 mean absolute error、provisional rank 与 Full Ranker expected ordering 的 rank error，以及 Top-K 集合交集比例。

在 50 部链式基准中，单次新增 comparison 的结果为：

```text
strategy             mean error   mean rank error   Top10   Top20
warm_start_map       ~0            4.04             0.80    0.95
local_laplace        0.002753      3.92             0.80    0.95
local_neighborhood   0.000775      3.92             0.80    0.95
```

这里的 rank error 主要来自“按 mean 排序的 provisional rank”与“完整 posterior sampling 得到的 expected rank”本来就不是同一个量；不能把它解释为 Fast Path 的 mean 数值误差。Top-K 以集合交集计算，避免把临界位置的细微顺序变化夸大。

推荐 B 在连续更新的 50 部场景中记录到：

```text
updates   mean error   max mean error   mean rank error   Top10   Top20
1         0.015682     0.141790         3.40              0.70    0.95
5         0.054899     0.286270         2.52              0.90    0.90
10        0.093228     0.317308         2.76              0.80    0.95
20        0.140180     0.378708         3.52              0.90    0.90
```

同一场景的 C 在第 20 次约为 mean error `0.004425`、Top10 `0.90`、Top20 `0.90`，说明 C 的精度更好但成本也明显更高。

在 500 部单次新增 `LEFT_WIN(1, 500)` 的直接对照中，推荐 B 的 mean error 为 `0.000254`、max mean error 为 `0.068152`、mean rank error 为 `40.268`、Top10 为 `0.10`、Top20 为 `0.35`。A 的 mean error 仍接近 0，C 的 mean error 为 `0.000087`；三者的 rank error / Top-K 在这个“单链 + 弱先验”合成数据上都受到完整 posterior 不确定性影响。这个结果再次说明：Fast mean 的误差和 posterior expected rank 的差异必须分开观察，不能把该场景的 Top-K 数字直接当作线上质量结论。

这些是合成链式数据，不是生产用户历史的质量承诺。阶段 4B 应继续记录线上分布下的 Full Ranker 校准误差。

## 连续校准建议

阶段 4A 的离线结果支持以下 V1 策略：

* 普通 comparison 默认 B；
* 暂不把固定 `N=10` 写成数学保证；建议先以 `fast_update_count` 作为软上限，初始可在 10 次附近触发一次 Full Ranker，再用真实误差调整；
* 若新 Full Ranker 与 Fast State 的 A/B 或邻近作品 mean 差异超过产品阈值，立即以 Full Ranker 替换 Fast State；
* 若需要更低连续误差，可在 Full Ranker 任务尚未完成时选择 C，但它不是当前 V1 的默认路径；
* Full Ranker 完成后必须重建权威结果，并将 fast update count 清零。

## 不应走普通 Fast Update 的事件

| 事件 | 处理 |
| --- | --- |
| 普通 LEFT / RIGHT / TIE | 可以走 Fast Update |
| Score Anchor 改变 | 触发 Full Ranker；prior 发生变化，不做简单逆更新 |
| 新作品加入候选 | V1 触发 Full Ranker，以新的 Score Anchor prior 纳入模型 |
| comparison revoke | 触发 Full Ranker；删除旧 evidence 不做错误的逆更新 |
| algorithm config 改变 | 触发 Full Ranker；旧 Fast State 不可跨配置复用 |
| SKIP | 保存事实，但不更新偏好 |

## 与 Pair Selector 的衔接

`to_selector_candidates()` 生成混合输入：

* `preference_mean` 使用最新 Fast State；
* `expected_rank` 使用 `provisional_rank`；
* `preference_std`、`rank_low`、`rank_high`、`stability` 使用最近一次 Full Ranker；
* `comparison_count` 使用完整事实历史的当前计数。

这样下一题的选择可以看到最新排序，但不会因为一次局部近似而伪造 `STABLE`、`ORDER_UNCERTAIN` 或新的 rank interval。当前测试已验证该混合输入保持权威区间，并且最新 mean 确实传给 Selector。

## 阶段 4B 建议

下一阶段 Service 只需要负责：

1. 从数据库读取最近权威 Model Run、Score Anchor 和有效 comparison；
2. 创建或恢复 `FastPreferenceState`；
3. 在普通 comparison 提交后串行应用 Fast Update，并以幂等事实记录作为边界；
4. 将 Selector 输入使用 Fast State + 权威 uncertainty 的混合结果；
5. 在 Full Ranker 完成或强制事件发生时，以新权威结果替换整个 Fast State。

阶段 4A 不决定 Fast State 的最终持久化方式，也没有修改阶段 1 数据结构。
