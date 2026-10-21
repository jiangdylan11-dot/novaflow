"""Explicit source layout relationships; no image inference or model calls."""

KINDS = {'grid', 'characters', 'information', 'readouts', 'controls'}


def normalize_grid(sk):
    grid = sk.get('grid', {})
    if 'rows' in grid or 'columns' in grid:
        rows, columns = grid.get('rows'), grid.get('columns')
        if type(rows) is not int or type(columns) is not int:
            raise ValueError('UI网格需要分别声明rows行数和columns列数')
        if 'shape' in grid and grid['shape'] != [rows, columns]:
            raise ValueError('UI网格行列声明矛盾；不会自动转置或补格')
        grid['shape'] = [rows, columns]
    lengths = grid.get('row_lengths')
    if lengths is not None:
        shape = grid.get('shape', [])
        if len(shape) != 2 or lengths != [shape[1]] * shape[0]:
            raise ValueError('UI逐行格数与行列声明矛盾；不会自动补格')


def validate_grid_container(sk, container):
    cells = sorted(sk['grid']['cells'], key=lambda c: (c['row'], c['column']))
    instances = [c['symbol_id'] for c in cells]
    unique = list(dict.fromkeys(instances))
    members = container.get('children')
    if not isinstance(members, list) or members not in (instances, unique):
        raise ValueError('玩法网格分组必须逐项引用已有格位或首现顺序的符号，不能加入业务按钮或新格子')
    if any(container.get(k) for k in ['main', 'auxiliary_order', 'children_in_recognized_order']):
        raise ValueError('玩法网格分组不能声明主操作或业务控件')


def validate_regions(sk):
    regions = sk.get('regions', {})
    items = regions.get('items')
    if items is None:
        return
    if not isinstance(items, list) or not 1 <= len(items) <= 16:
        raise ValueError('UI区域清单无效')
    ids = [item.get('id') for item in items]
    if any(not isinstance(x, str) or not x or len(x) > 64 for x in ids) or len(ids) != len(set(ids)):
        raise ValueError('UI区域身份缺失或重复')
    order = regions.get('order', [])
    if len(order) != len(ids) or set(order) != set(ids):
        raise ValueError('UI区域顺序必须完整对应区域身份，不能遗漏或重复')
    if sum(item.get('kind') == 'grid' for item in items) != 1:
        raise ValueError('当前结构链需要一个明确的玩法网格区域')
    containers = {c['id']: c for c in sk.get('containers', [])}
    placed = set()
    for item in items:
        kind, label = item.get('kind'), item.get('label', '')
        if kind not in KINDS or not isinstance(label, str) or not label.strip() or len(label) > 40 or '\n' in label:
            raise ValueError('UI区域用途或功能标签无效')
        if kind == 'characters' and not sk.get('main_character_displays', {}).get('count'):
            raise ValueError('已声明独立人物区，但格外人物数量为零；请重新核对识别')
        for ident in item.get('container_ids', []):
            if ident not in containers or ident in placed:
                raise ValueError('UI区域引用未知或重复的分组')
            c = containers[ident]
            expected = {'grid_container': 'grid', 'shared_horizontal_strip': 'information',
                        'information_display': 'information', 'horizontal_readouts_with_adjusters': 'readouts',
                        'main_control_and_auxiliary_group': 'controls'}[c['type']]
            if expected != kind or c.get('region_id', item['id']) != item['id']:
                raise ValueError('UI分组与已声明区域用途矛盾')
            c['region_id'] = item['id']
            placed.add(ident)
    if placed != set(containers):
        raise ValueError('UI分组缺少明确区域归属；不会挪到默认位置')
    displays = sk.get('main_character_displays', {})
    character_items = displays.get('items')
    if character_items is not None:
        if not isinstance(character_items, list) or len(character_items) != displays.get('count'):
            raise ValueError('独立主角清单与已识别数量不符')
        known = {item['id']: item for item in items}
        main_ids = [x.get('id') for x in character_items]
        if any(not isinstance(x, str) or not x for x in main_ids) or len(main_ids) != len(set(main_ids)):
            raise ValueError('独立主角身份缺失或重复')
        for main in character_items:
            if main.get('framing') not in ['full','half','portrait'] and not (sk.get('grid',{}).get('reference_only') and main.get('framing')=='reference'):
                raise ValueError('独立主角展示裁切类型不完整')
            if known.get(main.get('region_id'), {}).get('kind') != 'characters':
                raise ValueError('独立主角未关联已识别人物区域')


def kind_order(sk):
    regions = sk.get('regions', {})
    items = {item['id']: item for item in regions.get('items', [])}
    return [items[x]['kind'] if x in items else x for x in regions.get('order', [])]


def region_labels(sk, defaults):
    regions = sk.get('regions', {})
    items = {item['id']: item for item in regions.get('items', [])}
    return [items[x]['label'] if x in items else defaults.get(x, '其他已识别区域') for x in regions.get('order', [])]


def container_location(sk, container):
    regions = sk.get('regions', {})
    ident = container.get('region_id')
    item = next((x for x in regions.get('items', []) if x['id'] == ident), None)
    if not item:
        return ''
    return '位于纵向第' + str(regions['order'].index(ident) + 1) + '区“' + item['label'] + '”的'


def independent_main_displays(case):
    # This path is only for a standalone hero with no avatar identity to reuse.
    if any(t['category'] == 'p' for t in case['targets']):
        return []
    displays = case['skeleton'].get('main_character_displays', {})
    count = displays.get('count') or 0
    if not count:
        return []
    return displays.get('items') or [{'id': 'main_' + str(i + 1)} for i in range(count)]
