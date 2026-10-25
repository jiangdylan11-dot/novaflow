"""Palette-free scope rules. No color parsing, replacement or model calls."""
UPSTREAM = ('每个图标都保留清楚固有色、可读中间调、亮面、暗面与有用的局部细节。'
            '各对象可以有不同而协调的颜色和材料，其具体类别、配色与工艺由你决定。'
            '肤色、服装、道具和按钮各有自身固有色与材质；环境氛围色用于受光与反射，保留本体色之间的区别。')
TYPED = ('各字段分别描述本体色、材质与必要局部光照；共用环境光和氛围色只在全局段说明一次。'
         '已给出的主体色彩、材质与明暗细节逐项继承，未给出的自主设计。')
COMPILED = ('肤色、服装、道具与按钮各保留自身固有色和材质，环境氛围色体现为受光与反射；'
            '用可读中间调、亮面、暗面和局部细节塑造体积。')


def rules(case):
    return ({'upstream':UPSTREAM,'typed':TYPED,'compiled':COMPILED}
            if case.get('options',{}).get('preserve_intrinsic_color') else {})
