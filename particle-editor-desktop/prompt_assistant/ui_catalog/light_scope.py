"""Assign scene lighting and local material design to distinct input scopes.

This transforms requests before PE, never PE answers or rendered pixels.
No color-word parsing, fixed palette, deduplication, or replacement of art.
"""
from copy import deepcopy
from .art_direction import UPSTREAM, TYPED

GLOBAL_VOLUME_OLD = '通过统一主辅光、受光面、接触阴影与自然反射形成层次'
GLOBAL_VOLUME_NEW = '全局说明主辅光方向与反射，各对象以本体色的亮暗面和接触阴影塑形'
UPSTREAM_OLD = '肤色、服装、道具和按钮各有自身固有色与材质；环境氛围色用于受光与反射，保留本体色之间的区别。'
UPSTREAM_NEW = '场景照明与对象配色分别设计：全局写光源方向与反射，各对象写本体色与材质层次。'
ITEM_OLD = '包含明确主体、构造、材质与明暗层次'
ITEM_NEW = '包含明确主体、构造、本体色与材质层次'
TYPED_NEW = '各字段描述本体色、材质及其体积明暗；共用环境光和氛围色只在全局段说明一次。逐项继承上游已定的主体配色和材质，缺失部分自主设计。'


def scope_request(system, context, stage, enabled=False):
    context = deepcopy(context)
    proof = {'enabled': enabled, 'stage': stage, 'replacements': [],
             'quarantined_context': {}, 'art_answer_edits': 0}
    if not enabled:
        return system, context, proof
    pairs = ([(GLOBAL_VOLUME_OLD, GLOBAL_VOLUME_NEW), (UPSTREAM_OLD, UPSTREAM_NEW)]
             if stage == 'upstream' else [(ITEM_OLD, ITEM_NEW), (TYPED, TYPED_NEW)])
    for old, new in pairs:
        assert system.count(old) == 1, 'Unexpected source contract; do not infer edits'
        system = system.replace(old, new, 1)
        proof['replacements'].append({'old': old, 'new': new})
    if stage == 'typed':
        # Compiler still receives the original global environment. The local
        # material designer receives only the component-scoped art context.
        local = context['preserved_AI_art_context']
        proof['quarantined_context']['environment_art'] = local.pop('environment_art')
    return system, context, proof
