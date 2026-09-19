# 红蓝合战阶段 2：纯偏好 Ranker

## 范围

Ranker 是与 SQLAlchemy 解耦的纯算法模块，入口为：

```python
rank_preferences(candidates, score_anchors, comparisons, config)
```

它只读取候选作品、`Rating.score_anchor` 对应的独立评分信号和历史 comparison，
返回 `PreferenceResult[]` 与 `RankerDiagnostics`。它不查询数据库、不写入数据库、
不选择下一组 pair，也不生成评分建议。

实现位置：`backend/services/red_blue_ranker.py`。

## Davidson 模型

每部作品有一个 latent preference `theta_i`。对作品 A、B，设：

```text
x = exp(theta_A)
y = exp(theta_B)
t = tie_strength * exp((theta_A + theta_B) / 2)
Z = x + y + t
```

则：

```text
P(A > B) = x / Z
P(A ≈ B) = t / Z
P(B > A) = y / Z
```

TIE 直接进入 Davidson likelihood，不会被转换为双方各半胜场。
`pairwise_probability()` 对外返回三个概率，和为 1。

## Score Anchor prior

Ranker 只接受 `ScoreAnchor.score`，不接受也不读取 `Rating.score`。

评分转换流程：

```text
score_anchor
→ 用户评分经验分布
→ score level mid-rank percentile
→ percentile clipping
→ Normal quantile
→ Gaussian prior mean / precision
```

同分使用 mid-rank，因此相同评分必然得到相同 prior。全部同分时 percentile 为 0.5，
prior mean 为 0。`score_prior_shrinkage` 根据评分样本数量收缩 prior precision，避免
少量评分形成过强先验。

每个 latent value 还带有很弱的 Gaussian baseline prior，用于解决整体平移的
identifiability，确保没有 comparison 或 comparison graph 断开时 Hessian 仍然适定。

## 重复 Pair

先按 unordered pair `(min(content_id), max(content_id))` 聚合，左右方向只用于将
结果转换到规范 pair 方向，不用于时间衰减。

同一 pair 有 `n` 条历史记录时，总有效权重为：

```text
effective_total_weight = min(cap, n ** exponent)
```

默认 `exponent=0.5`、`cap=8`。总权重再平均分配给该 pair 的每条记录。这样：

- 同方向结果增加证据；
- 相反结果互相制衡；
- TIE 保留为 TIE；
- A 左/B 右和 B 左/A 右属于同一个重复 pair；
- 不会因为后一次记录天然权重更低而引入时间偏置。

## MAP 与 Laplace

目标是最小化负 log posterior：

```text
negative_log_likelihood(Davidson comparisons)
+ Gaussian prior penalty
```

使用带回溯线搜索的 Newton 方法求 MAP。Davidson 每条 observation 的梯度和
Hessian 都直接由 softmax feature covariance 计算，不使用有限差分。

MAP 后计算负 log posterior Hessian `H`，使用：

```text
covariance = inverse(H)
```

并对数值误差造成的微小负特征值进行 eigenvalue floor 修正。后验采样使用完整的
多元 covariance，因此保留作品之间的相关性；完整 covariance 只在 Ranker 内存中
存在，不写入 `preference_results`。

## Ranking 与 Stability

从 `Multivariate Normal(mean, covariance)` 采样，得到每部作品的 rank distribution：

```text
expected_rank = rank samples 的均值
rank_low/high = RankerConfig 指定概率区间的保守整数边界
preference_std = covariance 对角线平方根
```

稳定性优先级为：

1. comparison 数量不足：`UNCALIBRATED`；
2. 有足够数据但邻近作品 pairwise confidence 不足或 tie probability 较高：`ORDER_UNCERTAIN`；
3. 满足比较数量和 rank interval 宽度阈值：`STABLE`；
4. 满足较弱阈值：`RELATIVELY_STABLE`；
5. 其他情况：`CALIBRATING`。

因此 `ORDER_UNCERTAIN` 优先于 `STABLE`。`content_id` 只用于结果相同 expected rank
时的技术层确定性排序，不进入 latent model，也不具有产品排序意义。

`comparison_count` 始终是当前作品参与的、未撤销、非 SKIP 的原始 comparison 条数，
不是重复 pair 加权后的有效次数。

## 配置与依赖

全部模型参数集中在 `RankerConfig`，包括：

- 算法版本；
- Score Anchor prior 强度、尺度、clip、shrinkage；
- Davidson tie strength；
- 重复 pair exponent 与 cap；
- optimizer tolerance、迭代次数、line search 系数；
- covariance 数值保护；
- posterior sample 数、rank interval 概率、random seed；
- Stability 的比较数量、区间宽度和 pairwise 阈值。

`RankerConfig.to_json()` 的结果可直接写入阶段 1 的 `algorithm_config_json`。

新增依赖只有 NumPy。它用于 dense Hessian 的线性代数、特征分解和多元采样；没有
引入 SciPy。当前 500 部候选的完整 covariance 仍在可接受范围内，但 Ranker 每次
全量重算的同步策略应由后续 Service 根据实际 comparison 频率决定。

## 当前性能基线

在当前 Python 3.12 / NumPy 2.4.4 环境，使用 3 次链式 comparison、64 个 posterior
samples、最多 40 次 Newton iteration：

```text
50  candidates: total 约 0.10s
100 candidates: total 约 0.86s
500 candidates: total 约 9.66s
```

500 部测试中 MAP、covariance、sampling 分别约 3.18s、3.24s、2.34s。该数据只作为
阶段 2 基线，不代表生产数据分布。
