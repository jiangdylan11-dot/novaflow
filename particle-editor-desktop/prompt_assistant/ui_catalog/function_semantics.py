"""Finite, explicitly scoped function-semantic normalization. No PE/model calls."""
import re
from .business_guard import claims_primary_rotation


def normalize_rotation(text):
    changes = []
    for old, new in [
        ('箭头呈环状排列指向中心','箭头沿圆周连续环行'),
        ('方向性旋转箭头','沿圆周连续环行的旋转箭头'),
    ]:
        if old in text:
            assert text.count(old)==1, 'Ambiguous functional clause; do not guess'
            text = text.replace(old,new,1)
            changes.append({'before':old,'after':new,'scope':'main rotation arrow direction only'})
    return text, changes


def remove_special_primary_claim(text):
    pieces, changes = [], []
    for match in re.finditer(r'[^，,；;。]+[，,；;。]?',text):
        whole = match.group()
        clause = whole.rstrip('，,；;。')
        if claims_primary_rotation(clause):
            # This normalizer only deletes the isolated role claim, never art.
            if not re.fullmatch(r'(?:整体)?(?:一眼)?可辨为主旋转操作',clause):
                raise ValueError('Role conflict is not an isolated supported phrase; report, no automatic rewrite')
            changes.append({'before':whole,'after':'','scope':'special symbol cannot claim main action'})
        else:
            pieces.append(whole)
    return ''.join(pieces), changes
