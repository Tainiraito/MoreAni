# 红蓝合战阶段 3.1：纯 Pair Selector 收尾

> 本文记录阶段 3.1 的 Selector 设计和实验；当前 coverage 参数、Focus 行为与系统边界见[阶段 8 综合设计](red-blue-battle.md)。

## 范围与边界

实现位置：`backend/services/red_blue_pair_selector.py`。

入口：

```python
select_pair(candidates, comparisons, context, config)
```

Selector 只回答“下一题问哪两部作品”，不重新拟合 Ranker，不查询或写入数据库，
不调用 Rating Service，不创建 comparison，不创建 Model Run，也不生成 Score Suggestion。

阶段 2 的 Ranker 仍然负责“现在怎么排”。Selector 只消费 Ranker 的边际快照：
`preference_mean`、`preference_std`、`expected_rank`、rank interval、
`comparison_count` 和 `stability`。Selector 不读取当前 `Rating.score`。

## 输入输出

输入类型：

- `SelectorCandidate`：候选作品和当前排名快照，可选 `score_anchor` 仅用于排名快照缺失时的粗粒度 fallback；
- `SelectorComparison`：保留左右方向、结果和时间的历史交互；
- `SelectorContext`：一次请求的 `focus_content_id`、最近发生 anchor 改动的作品集合、
  当前 Davidson `tie_strength` 快照和可选当前时间；
- `SelectorConfig`：全部 acquisition、探索、冷却、曝光和确定性参数。

输出类型：

- `SelectedPair`：最终有向展示位置、`selection_reason`、`selector_version`、总分和 debug components；
- `PairSelectionResult`：允许 `selected_pair=None`，同时返回无结果原因和诊断；
- `SelectorDiagnostics`：Pair 数量、过滤原因、fallback、Focus、探索和分阶段耗时。

Selector 先选择无序 Pair `{A, B}`，最后才使用固定 seed 的随机源决定左右展示位置。
因此 `A/B` 与 `B/A` 的历史会被视为同一 Pair。

## Acquisition score

V1 使用 uncertainty-aware acquisition heuristic，不称为严格 Expected Information Gain。
阶段 2 的持久化结果没有完整 posterior covariance，Selector 没有足够信息计算严格的
后验信息增益。

对每个无序 Pair，所有正向 component 归一化到 `[0, 1]`：

```text
pair_score =
    uncertainty_weight       * uncertainty_score
  + rank_overlap_weight      * rank_interval_overlap
  + rank_proximity_weight    * rank_proximity
  + underexplored_weight     * underexplored
  + new_content_weight       * new_content
  + graph_connectivity_weight* graph_connectivity
  + rank_boundary_weight     * rank_boundary
  + anchor_changed_weight    * anchor_changed
  + focus_weight             * focus
  - repeat_pair_penalty      * repeat_recency_penalty
  - skip_pair_penalty        * skip_recency_penalty
  - content_recency_penalty  * content_recency_penalty
  - excessive_repeat_penalty * excessive_repeat_penalty
```

实际实现没有把 component 写成固定不可调系数；权重全部位于 `SelectorConfig`。
`SelectedPair.components` 保存归一化 component、惩罚、冷却状态、探索分数和最终分数，
用于测试、调参和未来诊断。

### Outcome uncertainty

Selector 和 Ranker 共同使用 `backend/services/red_blue_math.py` 中的纯 Davidson
`pairwise_probability()`，不再各自维护公式。Selector 不调用 `rank_preferences`，也不依赖
Ranker 的运行状态；它只接收当前运行的 `tie_strength` 快照。得到：

```text
P(A胜), P(TIE), P(B胜)
```

结果熵为：

```text
H = -Σ p log(p)
outcome_entropy = H / log(3)
```

再与两部作品的 `preference_std` 合成：

```text
uncertainty_score =
    0.7 * outcome_entropy
  + 0.3 * clip(mean(preference_std) / preference_std_scale, 0, 1)
```

因此不会只检查 `P(A胜) ≈ 50%`，TIE 概率也会影响 Pair 价值。

### Rank interval 与 proximity

区间重叠使用闭区间 IoU：

```text
intersection / union
```

缺少完整 rank interval 时返回中性值 `0.5`，不会让 Selector 崩溃。

Expected rank 距离使用指数衰减：

```text
rank_proximity = exp(-abs(expected_rank_A - expected_rank_B) / rank_proximity_scale)
```

因此相邻排名通常优于相距很远的作品，但不会成为唯一选择依据。

### Coverage、新作品和 anchor change

```text
underexplored = 1 / (1 + min(comparison_count_A, comparison_count_B)
                         / underexplored_scale)
new_content = 1 if min(comparison_count_A, comparison_count_B) == 0 else 0
```

新作品和低覆盖作品有 bonus，但同时受近期曝光与连续曝光控制。

`SelectorContext.recently_anchor_changed_content_ids` 提供临时 bonus，不查询
`RatingRevision`，也不持久化 Context。

## Adaptive Pair Shortlisting

候选数不超过 `exhaustive_candidate_threshold` 时，继续枚举全部合法 Pair，保证小候选池
精确选择。默认阈值为 `100`。

超过阈值时，先生成去重后的 Pair shortlist，再对 shortlist 计算完整 acquisition score。
shortlist 不是随机抽样，来源包括：

1. expected rank 邻域：每个作品向前后 `rank_neighbor_window` 个位置；
2. rank interval sweep：使用 active interval heap，为每个区间保留有限个高覆盖重叠对手；
3. new / underexplored：优先选择低 `comparison_count` 或 `UNCALIBRATED` seed；
4. Focus：保证 `focus_content_id` 生成邻近排名和跨 component 对手；
5. anchor changed：保证最近 anchor 变化作品生成有限对手；
6. graph exploration：从孤立、低 degree seed 生成跨 component Pair；
7. rank boundary：加入重要边界附近的作品组合；
8. exploration pool：保留低 coverage、跨 component 和较远排名区域的少量 Pair。

来源 Pair 先去重，再使用轻量 preliminary priority 截断到 `max_pair_evaluations`；每个
来源至少保留一个候选，最终仍由完整 acquisition score 决定。诊断中记录各来源贡献和
实际 `pair_evaluation_count`。

如果 shortlist 中没有合法 Pair，但全局仍存在合法 Pair，Selector 会先扫描 cooldown、
skip 和曝光规则，使用 preliminary priority 补充有限 fallback Pair，再执行完整评分。
只有两部作品且唯一 Pair 仍处于冷却时才返回 `COOLDOWN`；不会因为 shortlist 漏选而错误
返回无结果。

## Comparison graph

Selector 使用普通 `dict`、`set` 和轻量 union-find 构建无向 graph：

- 节点是当前候选作品；
- 非 SKIP、未撤销 comparison 形成 edge；
- SKIP 只进入近期 interaction，不形成排序 edge；
- 孤立节点各自是独立 component；
- 不同 component 的 Pair 获得最高 `graph_connectivity`；
- 同 component 内的低 degree 节点仍获得一定 coverage bonus。

没有引入 `networkx`。

## Exploration

默认 `exploration_rate=0.12`。多数请求按总 acquisition score exploitation，约 12% 请求
按 exploration score 选择：

```text
exploration_score = normalize(
    exploration_graph_weight       * graph_connectivity
  + exploration_underexplored_weight* underexplored
  + exploration_distance_weight    * normalized_rank_distance
)
```

探索仍然是受约束的，不是 `random.sample(all_anime, 2)`。它优先连接不同 graph component、
覆盖较低作品和排名上较远的区域，用于避免局部排名岛。

## Pair cooldown 与 SKIP

历史先按 `created_at`、`id` 稳定排序为最近优先，时间为空时使用 `id`。

- `pair_cooldown_count`：同一无序 Pair 最近 N 条交互内暂不重复；
- `pair_cooldown_seconds`：可选，需要 `SelectorContext.now`；
- `skip_cooldown_count`：SKIP 的独立短期冷却；
- `skip_cooldown_seconds`：可选的时间冷却；
- SKIP 只提高 `skip_recency_penalty` 并进入冷却，不影响 Ranker。

冷却不是永久屏蔽。三部或以上候选且全部 Pair 都被冷却时，Selector 放宽冷却并选择
惩罚后分数最高的 Pair，同时返回 `COOLDOWN_FALLBACK` 和 `fallback_used=true`。
只有两部候选且唯一 Pair 仍在冷却时返回 `selected_pair=None`、原因 `COOLDOWN`，避免
页面立即无限重复同一 Pair。

## 作品曝光控制

`max_recent_exposure` 用于计算近期作品曝光惩罚。
`max_consecutive_content_exposure` 默认限制普通模式下作品连续出现在历史交互中的次数。
达到限制的作品 Pair 会暂时排除，Focus 模式对 focus 作品放宽这一限制；如果因此没有
任何可用 Pair，仍会进入统一 fallback。

## Focus Mode

Focus 只是 `SelectorContext.focus_content_id`，不是 BattleSession。

当 Focus Pair 可用时，以 `focus_probability`（默认 0.80）进入 Focus 分支，选择包含
Focus 作品且 acquisition score 最高的 Pair。对手仍受 rank overlap、rank proximity、
outcome uncertainty、历史冷却和曝光控制影响，因此会优先选择预计排名附近的作品。

未进入 Focus 分支的请求仍执行普通 exploitation 或 exploration，不保证每一题都包含 Focus。

## Rank boundary

`important_rank_boundaries` 默认是 `(10,)`。Pair 中距离任一边界最近的作品越近，
`rank_boundary` 越高：

```text
rank_boundary = exp(-minimum_distance_to_boundary / rank_boundary_scale)
```

它只是一个 component，不会让 Top 10 成为整个算法的唯一中心。

## 没有完整 Ranker 结果

如果 `expected_rank` 缺失，Selector 优先使用 `score_anchor` 做粗略 rank，否则使用稳定的
`content_id` 顺序。缺失 rank interval 时使用中性 overlap 分数。Selector 不重新拟合模型，
只提供不会崩溃的 fallback。

## 配置默认值

`SelectorConfig` 包括：

- 版本：`selector-v2`；
- 探索：`exploration_rate=0.12`；
- 正向权重：uncertainty 1.30、overlap 1.10、proximity 0.80、underexplored 1.00、
  new content 1.20、graph 0.90、boundary 0.55、anchor changed 0.75、focus 1.00；
- shortlist：候选数 `<=100` exhaustive，`max_pair_evaluations=6000`；
- shortlist 窗口：rank neighbor 8、interval opponent 8、underexplored seed 32、
  underexplored opponent 8、Focus opponent 16、anchor changed seed 16、
  cross component 6、exploration seed 24、exploration Pair 64、boundary window 6；
- Davidson：由 `SelectorContext.tie_strength` 接收当前 Ranker/Model Run 的值；缺失时只使用
  `red_blue_math.DEFAULT_TIE_STRENGTH=0.80` 作为无完整模型状态的 fallback；
- 普通 coverage：目标按候选数的 `ceil(log2(N))` 伸缩并限制在 4–8 次；候选曝光差距超过当前最低值加目标时暂停入选。若有限 shortlist 漏掉所有低覆盖合法 Pair，只在低覆盖候选池补选；Focus 保留目标优先且仍遵守 Pair 上限。
- Focus：`focus_probability=0.80`；
- cooldown：Pair 最近 2 条，SKIP 最近 5 条；
- 曝光：最近 8 条、默认连续曝光上限 2；
- boundary：`(10,)`；
- 默认 `random_seed=None`，生产环境使用正常随机源；测试显式传固定 seed，例如 `0`。

所有参数支持 `to_json()` / `from_json()`，可以作为未来 Selector 配置快照的基础。

## 性能

小候选池仍是 O(n²) exhaustive；大候选池的完整 acquisition scoring 受
`max_pair_evaluations` 限制。近期 Pair 位置、作品曝光和 graph 信息会先预计算一次，
避免每个 Pair 重复扫描完整历史。当前没有引入 shortlist 以外的依赖或图算法库。

阶段测试分别输出：

```text
shortlist construction
full acquisition scoring
selection
total
pair evaluations
```

当前基线（Python 3.12、本地 NumPy 环境）为：

```text
50   candidates: 1,225 evaluations，约 0.035s
100  candidates: 4,950 evaluations，约 0.144s
500  candidates: 5,060 evaluations，约 0.222s
1000 candidates: 6,000 evaluations，约 0.434s
```

500 部已明显低于阶段 3 的约 3.32s；1000 部仍保持在约 0.5s 内。

质量回归在 6 组 20～100 部候选上，固定 `random_seed=0`、关闭 exploration，比较
shortlist selected acquisition score 与 exhaustive best：

```text
average = 1.0000
P50     = 1.0000
minimum = 1.0000
```

这表示当前合成场景中 shortlist 选到 exhaustive 最佳 Pair；该数据是回归基线，不是
未经真实用户数据验证的普遍质量承诺。

## 本阶段没有调整的结构

没有新增 migration、表、Model Run、API 或前端路由。
新增了无 NumPy 强依赖的共享 `red_blue_math.py`，Ranker 和 Selector 共用 Davidson
概率函数；没有修改 Ranker 的 prior、MAP、covariance、ranking、stability 或 sampling。
阶段 2 Ranker 输出已经包含 Selector 所需的边际字段，因此不需要调整 Ranker 输出。
阶段 1 的 `red_blue_comparisons` 已提供 Selector 所需的 outcome、时间和撤销状态。

## 已知限制

1. Selector 不持有完整 posterior covariance，因此 acquisition score 不是严格 Expected Information Gain。
2. shortlist 是高质量启发式候选集，不保证任意数据分布下 100% 复现 exhaustive 最优 Pair；
   低覆盖 fallback 在 shortlist 没有低覆盖合法 Pair 时触发；通用 cooldown fallback 只在 shortlist 没有合法 Pair 时触发。
3. 当前曝光控制基于输入 comparison 历史的最近顺序，不保存 Selector 自己的会话状态。
4. `pair_cooldown_seconds` 和 `skip_cooldown_seconds` 需要上游提供 `SelectorContext.now`，
   以保持纯函数和可重放性。
5. `stability` 当前作为输入保留，V1 主要依赖 Ranker 的 mean/std、rank interval 和 comparison count；
   不在 Selector 内重复实现 stability 判断。
