# 红蓝合战评分校准算法

> 本文记录阶段 5 的纯评分校准算法；当前阈值、持久化与前端展示以[阶段 8 综合设计](red-blue-battle.md)为准。

阶段 5 只实现从个人偏好模型生成评分校准建议的纯算法。实现位于
`backend/services/red_blue_score_calibration.py`，不访问数据库、不写入
`Rating`、`RatingRevision`、`ScoreSuggestion` 或 `ScoreSuggestionAction`。

## 输入与输出

`generate_score_calibrations` 接收候选作品、偏好结果、当前评分与评分锚点，
并可接收历史 suggestion action 和上一轮活跃 suggestion。返回：

- `suggestions`：达到展示阈值的 `ScoreCalibrationSuggestion`；
- `evaluations`：所有候选的诊断结果，包括没有建议的排除原因；
- `diagnostics`：样本数、模型新鲜度、各阶段耗时和正式建议数。

`score_anchor` 是校准曲线的唯一训练标签。`Rating.score` 只用于检测当前
显示评分是否落在模型预测范围之外，因此 PK 建议修改出来的当前评分不会重新
训练同一条曲线。

## Personal Score Calibration Curve

对每个目标作品分别执行 Leave-One-Out：目标作品自己的
`(preference_mean, score_anchor)` 不进入该目标的训练点。其余训练点按
`preference_mean` 排序后使用手写 PAVA 拟合非递减 isotonic curve，所有锚点
初始权重为 1。

PAVA 输出是分段阶梯函数，平台值允许相同。两个训练点之间使用左侧平台值，
不在平台范围内做线性插值；这样不会把排名分辨率伪装成评分精度，也不会强制
相邻排名必须拥有不同评分。

V1 不引入 SciPy 或 scikit-learn。评分档样本过少时由 `min_local_support`
和不确定性过滤建议：局部支持不足不会生成 suggestion，即单个高分样本不
能单独制造一批高分建议。

## 预测区间

对目标 preference，局部支持定义为：

```text
abs(training_preference - target_preference)
    <= local_preference_band_width
```

若局部点至少 2 个，使用局部残差；否则使用全部训练点残差。残差样本标准差
带有 `calibration_noise_floor` 下限。预测标准差为：

```text
sigma_prediction = sqrt(
    sigma_noise^2
    + (preference_std * preference_uncertainty_score_scale)^2
    + (
        (rank_high - rank_low) / max(candidate_count - 1, 1)
        * rank_interval_score_scale
      )^2
)
```

`prediction_interval_probability` 默认 0.80，使用正态分位点生成连续区间：

```text
predicted_score +/- z * sigma_prediction
```

区间先限制到 `[0, 100]`，最终展示的 low/high/recommended 再按
`score_step=5` 四舍五入。推荐值和区间始终保持在当前评分对应的建议方向一侧。

## 置信度与严重度

当前评分在连续预测区间之外的距离为 `outside_margin`。置信度使用以下可解释
的加权公式，最终限制在 `[0, 1]`：

```text
disagreement = clamp(outside_margin / max(min_score_delta, 1))
uncertainty = exp(-sigma_prediction / confidence_uncertainty_scale)
support = clamp(local_support / local_support_saturation)
sample_support = clamp(
    calibration_sample_count / (2 * min_calibration_samples)
)

confidence = clamp(
    0.45 * disagreement
    + 0.25 * uncertainty
    + 0.20 * support
    + 0.10 * sample_support
)
```

严重度用于排序和后续 UI 限制同时展示数量：

```text
severity = clamp(
    abs(predicted_score - current_score)
    / (2 * min_score_delta)
) * confidence
```

它不是新的评分，也不修改任何持久化数据。

## 生成条件

目标作品必须同时满足：

1. 不是 `BOOTSTRAP` 或 `STALE_REQUIRES_FULL` 模型；
2. LOO 校准样本数不少于 `min_calibration_samples`；
3. `comparison_count` 不少于 `min_comparisons_for_suggestion`；
4. stability 至少达到 `min_stability`，默认允许 `RELATIVELY_STABLE` 和 `STABLE`；
5. 局部支持不少于 `min_local_support`；
6. 当前评分不在连续预测区间内；
7. 预测值与当前评分的绝对差达到 `min_score_delta`；
8. 置信度达到当前模型新鲜度对应阈值；
9. 没有被同一 suggestion key 的历史动作抑制。

方向和原因码对称：预测值高于当前评分时为 `UP` /
`PREFERENCE_HIGHER_THAN_SCORE`，低于当前评分时为 `DOWN` /
`PREFERENCE_LOWER_THAN_SCORE`。

## FULL、FAST 与 BOOTSTRAP

- `FULL` 使用 `confidence_threshold`，默认 0.80；
- `FAST` 使用更严格的 `fast_confidence_threshold`，默认 0.90。调用方可以
  将实时 preference mean 与最近 Full 快照提供的 uncertainty 一起传入；
- `BOOTSTRAP` 永不生成建议，因为此时偏好仍主要来自评分先验；
- `STALE_REQUIRES_FULL` 永不生成建议，等待 Full 结果。

算法不自行判断 Fast 快照是否覆盖了 Full 的 rank interval；调用方应把同一份
`CalibrationPreferenceResult` 组装成“Fast mean + 最近 Full uncertainty”的
输入契约。

## suggestion_key 与 action 抑制

V1 key 语义为：

```text
sc-v1:{content_id}:{current_score}:{recommended_score}:{direction}
```

其中不包含 `model_run_id`，因此同一建议在不同重算中仍能识别。推荐值发生
实质变化，或当前评分发生变化，就会得到新的 key。

算法只读取 action，数据库中的 `score_suggestion_actions` 是行为事实来源；
`score_suggestions.status` 只能作为派生缓存。每个
`(content_id, suggestion_key)` 只取最新 action：

- `REJECTED`：相同 key 永久抑制；
- `ACCEPTED`：相同 key 永久抑制；若用户评分已经被改为推荐值，通常也会因
  当前评分变化自然得到新 key；
- `DISMISSED`：默认抑制 14 天；如果 action 保存的 comparison count 增加
  至少 2，则视为新证据并解除抑制；
- 旧 key 与新 key 不互相抑制。

Hysteresis 只对“同一 content、同一 key、仍然 active”的上一轮建议生效：
再次维持建议只需达到 `hysteresis_confidence_threshold`，默认 0.70；新
推荐值不会因为旧建议存在而绕过正常进入阈值。

## 默认配置

`ScoreCalibrationConfig` 可通过 `to_json` / `from_json` 序列化：

```text
algorithm_version = score-calibration-v1
min_calibration_samples = 5
min_comparisons_for_suggestion = 4
min_stability = RELATIVELY_STABLE
min_score_delta = 5
score_step = 5
prediction_interval_probability = 0.80
local_preference_band_width = 0.75
min_local_support = 2
local_support_saturation = 8
calibration_noise_floor = 2.5
preference_uncertainty_score_scale = 8
rank_interval_score_scale = 25
confidence_uncertainty_scale = 12
confidence_threshold = 0.80
fast_confidence_threshold = 0.90
hysteresis_confidence_threshold = 0.70
dismissed_suppression_days = 14
dismissed_new_evidence_comparisons = 2
max_suggestions = 10
```

`algorithm_version` 和配置快照由上层 model run 负责持久化；本纯算法模块不
创建或更新 `preference_model_runs`。

## 性能边界

测试在当前开发环境使用 50、100、500、1000 部候选运行完整 LOO 流程，并输出
fit、prediction、filtering、total 四段耗时。当前实测约为：

| 候选数 | total |
| ---: | ---: |
| 50 | 0.01 s |
| 100 | 0.02 s |
| 500 | 0.32 s |
| 1000 | 1.28 s |

500 部达到实时交互级目标；1000 部主要耗时在每个目标的 LOO PAVA 拟合，后续
若产品要求更大规模，可在不改变输入输出语义的前提下增加批量 LOO 优化。

## 下一阶段集成边界

下一阶段 Service 负责：

1. 从当前用户候选池、Full/Fast preference result、Rating 和 action 表组装
   纯算法输入；
2. 把 `ScoreCalibrationSuggestion` upsert 到 `score_suggestions`；
3. 读取 `score_suggestion_actions` 作为权威行为历史；
4. 用户 ACCEPTED 后才执行 Rating / RatingRevision 更新，并根据来源规则
   保持 `score_anchor` 不被 `pk_suggestion` 修改；
5. 在 Full 重算后重建派生 result 和 suggestion，而不删除 action 事实。
