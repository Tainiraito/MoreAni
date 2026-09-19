"""红蓝合战共享的纯数学函数。

本模块不依赖 NumPy、SQLAlchemy 或应用状态，Ranker 和 Pair Selector 都从这里
取得 Davidson 三分类概率，保证 tie_strength 与概率定义只有一个事实来源。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

DEFAULT_TIE_STRENGTH = 0.80


@dataclass(frozen=True, slots=True)
class PairwiseProbability:
    """Davidson pairwise probability。"""

    win_a: float
    tie: float
    win_b: float


def validate_tie_strength(tie_strength: float) -> float:
    """校验并返回正的有限 Davidson tie strength。"""
    if tie_strength <= 0 or not math.isfinite(tie_strength):
        raise ValueError('tie_strength 必须是正的有限数')
    return float(tie_strength)


def pairwise_probability(
    preference_a: float,
    preference_b: float,
    tie_strength: float = DEFAULT_TIE_STRENGTH,
) -> PairwiseProbability:
    """计算 Davidson 的 P(A>B)、P(A≈B)、P(B>A)。"""
    if not math.isfinite(preference_a) or not math.isfinite(preference_b):
        raise ValueError('preference 必须是有限数')
    strength = validate_tie_strength(tie_strength)
    logits = (
        preference_a,
        preference_b,
        (preference_a + preference_b) / 2 + math.log(strength),
    )
    maximum = max(logits)
    exponentials = tuple(math.exp(logit - maximum) for logit in logits)
    normalizer = sum(exponentials)
    return PairwiseProbability(
        win_a=exponentials[0] / normalizer,
        tie=exponentials[2] / normalizer,
        win_b=exponentials[1] / normalizer,
    )


__all__ = [
    'DEFAULT_TIE_STRENGTH',
    'PairwiseProbability',
    'pairwise_probability',
    'validate_tie_strength',
]
