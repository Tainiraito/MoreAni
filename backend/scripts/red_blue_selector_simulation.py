"""红蓝 Selector 覆盖/重复 Pair 的合成模拟。

用于比较本阶段改动前后的正常模式和 Focus 模式，不读取或写入 MoreAni 数据库。
运行：``cd backend && PYTHONPATH=. venv/bin/python scripts/red_blue_selector_simulation.py``。
"""

from __future__ import annotations

import math
import statistics
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace

from services.red_blue_pair_selector import (
    SelectorCandidate,
    SelectorComparison,
    SelectorConfig,
    SelectorContext,
    SelectorOutcome,
    select_pair,
)

CHECKPOINTS = {50: (100, 300, 500), 100: (300, 500, 1000), 500: (500, 1000, 3000)}


def _percentile(values: list[int], probability: float) -> float:
    """用线性插值计算百分位。"""
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _config(*, before: bool) -> SelectorConfig:
    """构造旧行为基线或当前行为配置。"""
    # 合成 benchmark 使用和生产相同的 acquisition 组件，但固定 shortlist
    # 上限，避免 12 个场景把 100/500 部分的全量 Pair 评分重复数万次。
    benchmark_bounds = {
        'exhaustive_candidate_threshold': 0,
        'max_pair_evaluations': 64,
        'rank_neighbor_window': 3,
        'rank_interval_opponent_count': 3,
        'underexplored_content_count': 8,
        'underexplored_opponent_count': 3,
        'exploration_seed_count': 8,
        'exploration_pair_count': 8,
    }
    if not before:
        return SelectorConfig(random_seed=17, **benchmark_bounds)
    return SelectorConfig(
        random_seed=17,
        **benchmark_bounds,
        coverage_floor_weight=0.0,
        max_pair_comparisons=10**9,
        focus_max_pair_comparisons=10**9,
        repeat_pair_pressure_weight=0.0,
    )


def _metrics(
    counts: list[int],
    pair_counts: Counter[tuple[int, int]],
    candidate_count: int,
    selection_count: int,
) -> dict[str, object]:
    """汇总某个 checkpoint 的覆盖指标。"""
    mean = statistics.fmean(counts) if counts else 0.0
    std = statistics.pstdev(counts) if len(counts) > 1 else 0.0
    return {
        'candidate_count': candidate_count,
        'selection_count': selection_count,
        'min': min(counts, default=0),
        'p25': round(_percentile(counts, 0.25), 3),
        'median': round(_percentile(counts, 0.5), 3),
        'p75': round(_percentile(counts, 0.75), 3),
        'max': max(counts, default=0),
        'std': round(std, 3),
        'cv': round(std / mean, 3) if mean else 0.0,
        'unique_pairs': len(pair_counts),
        'max_repeated_pair': max(pair_counts.values(), default=0),
    }


def _run(candidate_count: int, *, before: bool, focus: bool) -> list[dict[str, object]]:
    """按候选规模运行指定 checkpoint，并以步进种子模拟独立随机选择。"""
    counts = [0] * candidate_count
    comparisons: list[SelectorComparison] = []
    pair_counts: Counter[tuple[int, int]] = Counter()
    config = _config(before=before)
    checkpoints = set(CHECKPOINTS[candidate_count])
    focus_selected_count = 0
    focus_available_count = 0
    snapshots: list[dict[str, object]] = []
    for comparison_id in range(1, max(checkpoints) + 1):
        candidates = [
            SelectorCandidate(
                content_id=index,
                preference_mean=(candidate_count - index) / max(candidate_count, 1),
                preference_std=0.7,
                expected_rank=float(index),
                rank_low=index,
                rank_high=index,
                comparison_count=counts[index - 1],
                score_anchor=float(candidate_count - index),
            )
            for index in range(1, candidate_count + 1)
        ]
        result = select_pair(
            candidates,
            # 生产 Service 默认只把最近 200 条历史交给 Selector。
            comparisons[-200:],
            context=SelectorContext(
                focus_content_id=1 if focus else None,
                pair_comparison_counts=pair_counts,
            ),
            config=replace(config, random_seed=17 + comparison_id),
        )
        focus_available_count += int(result.diagnostics.focus_available)
        focus_selected_count += int(result.diagnostics.focus_selected)
        if result.selected_pair is None:
            break
        pair = tuple(sorted((result.selected_pair.left_content_id, result.selected_pair.right_content_id)))
        pair_counts[pair] += 1
        left_id, right_id = result.selected_pair.left_content_id, result.selected_pair.right_content_id
        outcome = SelectorOutcome.LEFT_WIN if left_id < right_id else SelectorOutcome.RIGHT_WIN
        comparisons.append(
            SelectorComparison(
                id=comparison_id,
                left_content_id=left_id,
                right_content_id=right_id,
                outcome=outcome,
                pair_comparison_count=pair_counts[pair],
            ),
        )
        counts[left_id - 1] += 1
        counts[right_id - 1] += 1
        if comparison_id in checkpoints:
            snapshot = _metrics(counts, pair_counts, candidate_count, comparison_id)
            snapshot['focus_selected_count'] = focus_selected_count
            snapshot['focus_available_count'] = focus_available_count
            snapshot['focus_selection_rate'] = (
                round(
                    focus_selected_count / focus_available_count,
                    3,
                )
                if focus_available_count
                else 0.0
            )
            snapshot['configured_focus_probability'] = config.focus_probability if focus else None
            snapshot['focus_content_comparisons'] = sum(
                amount for pair, amount in pair_counts.items() if focus and 1 in pair
            )
            snapshots.append(snapshot)
    return snapshots


def _run_scenario(scenario: tuple[bool, bool, int]) -> list[dict[str, object]]:
    """进程池 worker，隔离不同 synthetic 场景的 Python CPU 开销。"""
    before, focus, candidate_count = scenario
    return [
        {
            'phase': 'before' if before else 'after',
            'mode': 'focus' if focus else 'normal',
            **snapshot,
        }
        for snapshot in _run(candidate_count, before=before, focus=focus)
    ]


def main() -> None:
    """输出全部 synthetic 场景。"""
    scenarios = [
        (before, focus, candidate_count)
        for before in (True, False)
        for focus in (False, True)
        for candidate_count in (50, 100, 500)
    ]
    with ProcessPoolExecutor(max_workers=4) as executor:
        for scenario_rows in executor.map(_run_scenario, scenarios):
            for row in scenario_rows:
                print(row)


if __name__ == '__main__':
    main()
