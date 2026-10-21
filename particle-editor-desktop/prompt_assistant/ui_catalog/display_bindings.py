"""Source display IDs own instances; quoted design prose does not create IDs.

The legacy adapter accepts a finite, explicit display-list grammar. It is not
a general Chinese parser. Unsupported prose stays unknown and is not rewritten.
No model, runtime, retry, network, or image code is used here.
"""
import copy
import re


QUOTED = re.compile(r'["“]([^"”]+)["”]')
NUMBER = re.compile(r'(?<!\d)\d+(?:\.\d+)?(?!\d)')
LIST_HEAD = re.compile(
    r'横贯[一二三四五六七八九十\d]+处读数[，,]依次为|'
    r'(?:读数|显示项|展示项|信息显示|展示区)[，,]?依次为|'
    r'(?:^|[；;。])\s*依次为')
STYLE_PREFIX = re.compile(r'(?:字形|字体|字面|笔画|材质|排版|上述字形|同一字形)$')


def source_displays(case):
    """Reuse authoritative component IDs, never derive identity from a literal."""
    records, ids, component_ids = [], set(), set()
    for comp in case['skeleton'].get('components', []):
        if comp['id'] in component_ids:
            raise ValueError('Duplicate source component id: ' + comp['id'])
        component_ids.add(comp['id'])
        if comp.get('interaction_type') != 'display':
            continue
        ident = comp.get('display_id', comp['id'])
        if ident in ids:
            raise ValueError('Duplicate source display id: ' + ident)
        ids.add(ident)
        parts = comp.get('literal_parts') or ([comp['literal']] if comp.get('literal') else [])
        records.append({'display_id':ident, 'component_id':comp['id'],
                        'container':comp.get('parent'), 'literal_parts':parts,
                        'source_evidence':comp.get('source'), 'source_order':len(records)})
    return records


def display_contract(case):
    return {'schema':'source_display_bindings_v1', 'source_instances':source_displays(case),
            'instance_input':'display_designs.instances: one record per existing display_id; literal_parts immutable',
            'style_input':'display_designs.style_descriptions: references by display_ids; repeated literal mentions are permitted',
            'rule':'造型描述可重复提及同一字面；只有源display id定义显示实例。同字面不同id必须分别保留；不得新增或重复绑定显示id。内部id不得印入图片。',
            'automatic_analysis_or_repair':False}


def _items(text, start, end):
    """Split only enumeration separators outside quoted literals."""
    result, first, close = [], start, None
    for pos in range(start, end):
        char = text[pos]
        if close:
            if char == close:
                close = None
        elif char in ['"', '“']:
            close = '"' if char == '"' else '”'
        elif char == '、':
            result.append({'span':[first,pos], 'text':text[first:pos]})
            first = pos + 1
    result.append({'span':[first,end], 'text':text[first:end]})
    return result


def legacy_lists(text):
    """Only explicit render lists count. Font/material prose alone does not."""
    result = []
    for head in LIST_HEAD.finditer(text):
        start = head.end()
        tail = re.search(r'[；;。]|[，,](?:数字不作为按钮|字形说明|字体说明|材质说明)', text[start:])
        end = start + tail.start() if tail else len(text)
        result.append({'head_span':[head.start(),start], 'items_span':[start,end],
                       'head':head.group(), 'items':_items(text,start,end)})
    return result


def _ranges(record, literal):
    """Exact source substrings permit WIN + 20.00 to share one display ID."""
    for part_index, part in enumerate(record['literal_parts']):
        for match in re.finditer(re.escape(literal), part):
            # Do not bind 18 to the middle of 118 or 20 to 20.00.
            before, after = part[:match.start()], part[match.end():]
            if literal and literal[0].isdigit() and before and (before[-1].isdigit() or before[-1]=='.'):
                continue
            if literal and literal[-1].isdigit() and after and (after[0].isdigit() or after[0]=='.'):
                continue
            yield (part_index, match.start(), match.end())


def bind_list(declaration, records):
    used, mentions, styles, unbound = {}, [], [], []
    for item_index, item in enumerate(declaration['items']):
        for quoted in QUOTED.finditer(item['text']):
            literal = quoted[1]
            span = [item['span'][0]+quoted.start(), item['span'][0]+quoted.end()]
            mention = {'literal':literal, 'art_span':span, 'item_index':item_index,
                       'evidence':item['text']}
            if STYLE_PREFIX.search(item['text'][:quoted.start()].rstrip()):
                styles.append(dict(mention, role='style_description'))
                continue
            available = []
            possible_ids = []
            for record in records:
                ident = record['display_id']
                for source_range in _ranges(record,literal):
                    possible_ids.append(ident)
                    part, left, right = source_range
                    if not any(p==part and left < b and right > a
                               for p,a,b in used.get(ident, [])):
                        available.append((record,source_range))
            if available:
                record, source_range = available[0]
                ident = record['display_id']
                used.setdefault(ident,[]).append(source_range)
                mentions.append(dict(mention, role='instance_part', display_id=ident,
                                     source_part_index=source_range[0],
                                     source_literal_span=list(source_range[1:])))
            else:
                unbound.append(dict(mention, role='unbound_explicit_instance',
                                    matching_source_display_ids=list(dict.fromkeys(possible_ids))))
    return {'instances':mentions, 'style_descriptions':styles, 'unbound_instances':unbound,
            'source_display_ids':[r['display_id'] for r in records]}


def _structured_errors(case, records):
    declared = case.get('display_designs')
    if declared is None:
        return []
    by_id = {r['display_id']:r for r in records}
    errors, used = [], set()
    for index, entry in enumerate(declared.get('instances',[])):
        ident = entry.get('display_id')
        if ident not in by_id:
            errors.append({'code':'unknown_source_display_id','display_id':ident,'declaration_index':index})
        elif ident in used:
            errors.append({'code':'duplicate_source_display_binding','display_id':ident,'declaration_index':index,
                           'literal_parts':by_id[ident]['literal_parts']})
        elif entry.get('literal_parts') != by_id[ident]['literal_parts']:
            errors.append({'code':'immutable_display_literal_changed','display_id':ident,
                           'source':by_id[ident]['literal_parts'],'declared':entry.get('literal_parts')})
        used.add(ident)
    for index, entry in enumerate(declared.get('style_descriptions',[])):
        if not entry.get('display_ids'):
            errors.append({'code':'missing_style_display_reference','declaration_index':index})
        for ident in entry.get('display_ids',[]):
            if ident not in by_id:
                errors.append({'code':'unknown_style_display_reference','display_id':ident,'declaration_index':index})
    return errors


def audit_displays(case):
    records = source_displays(case)
    errors, declarations = _structured_errors(case,records), []
    for container_id, key in case.get('carrier_keys',{}).items():
        scoped = [r for r in records if r['container']==container_id]
        if not scoped:
            continue
        text = case.get('art',{}).get(key,'')
        for declaration in legacy_lists(text):
            binding = bind_list(declaration,scoped)
            entry = dict(declaration,container=container_id,art_key=key,binding=binding)
            declarations.append(entry)
            # Report only quoted explicit numeric declarations as hard errors.
            # Other unbound prose remains available as evidence, not a guess.
            numbers = list(dict.fromkeys(n for x in binding['unbound_instances'] for n in NUMBER.findall(x['literal'])))
            for number in numbers:
                source_hits = [{'display_id':r['display_id'],'literal_parts':r['literal_parts']}
                               for r in scoped if any(number in NUMBER.findall(p) for p in r['literal_parts'])]
                expected = sum(sum(NUMBER.findall(p).count(number) for p in r['literal_parts']) for r in scoped)
                actual = sum(NUMBER.findall(x['literal']).count(number)
                             for x in binding['instances']+binding['unbound_instances'])
                extras = [x for x in binding['unbound_instances'] if number in NUMBER.findall(x['literal'])]
                code = ('explicit_display_list_count_contradiction' if expected != actual
                        else 'explicit_display_part_binding_contradiction')
                errors.append({'code':code,'container':container_id,
                               'number':number,'source':expected,'declared':actual,
                               'source_displays':source_hits,'unbound_instances':extras,
                               'explanation':'Explicit render-list parts exhaust the source display IDs; repeated style descriptions are excluded.'})
    return {'errors':errors,'source_instances':records,'legacy_declarations':declarations,
            'style_mentions_do_not_create_instances':True,'automatic_repair':False}


def normalize_single_display_list(case):
    """One reviewable candidate; never called by audit/compile automatically.

    Supports only one source display and an extra item explicitly saying it
    uses exactly the retained item's treatment. Unique art or unknown grouping
    is refused, not silently deleted.
    """
    result = copy.deepcopy(case)
    before = audit_displays(case)
    edits = []
    for declaration in before['legacy_declarations']:
        binding = declaration['binding']
        if not binding['unbound_instances']:
            continue
        if len(binding['source_display_ids']) != 1:
            raise ValueError('Ambiguous multiple-display grouping; no automatic normalization')
        by_item = {}
        for extra in binding['unbound_instances']:
            by_item.setdefault(extra['item_index'],[]).append(extra)
        removed, coverage = set(), []
        for item_index, extra_mentions in by_item.items():
            item = declaration['items'][item_index]
            quotes = list(QUOTED.finditer(item['text']))
            if len(quotes)!=1 or len(extra_mentions)!=1:
                raise ValueError('Mixed unique content in extra instance; no normalization')
            q = quotes[0]
            if item['text'][q.end():].strip() not in ['同样处理','同上处理','同上']:
                raise ValueError('Extra instance may contain unique art; no normalization')
            retained = next((x for x in binding['instances'] if x['literal']==q[1]
                             and declaration['items'][x['item_index']]['text'].startswith(item['text'][:q.end()])),None)
            if retained is None:
                raise ValueError('No identical existing treatment to retain')
            removed.add(item_index)
            coverage.append({'removed_item':item,'retained_item':declaration['items'][retained['item_index']],
                             'display_id':retained['display_id'],
                             'reason':'Explicit same-treatment duplicate; all style is already in the retained item'})
        key = declaration['art_key']
        text = result['art'][key]
        # Only one finite list per art field is supported for exact span edits.
        if sum(x['art_key']==key for x in before['legacy_declarations'])!=1:
            raise ValueError('Multiple explicit lists in field; no normalization')
        left, right = declaration['head_span'][0], declaration['items_span'][1]
        keep = [item['text'] for index,item in enumerate(declaration['items']) if index not in removed]
        count = len(binding['source_display_ids'])
        replacement = '仅'+str(count)+'处信息显示，内部字面造型为'+'、'.join(keep)
        result['art'][key] = text[:left]+replacement+text[right:]
        edits.append({'art_key':key,'before_span':[left,right],'before':text[left:right],
                      'after':replacement,'source_display_ids':binding['source_display_ids'],
                      'retained_art_coverage':coverage,'new_theme_art':0})
    if edits:
        result['display_designs'] = {
            'instances':[{'display_id':r['display_id'],'literal_parts':r['literal_parts']}
                         for r in source_displays(case)],
            'style_descriptions':[{'display_ids':e['source_display_ids'],'art_key':e['art_key'],
                                   'text':e['after']} for e in edits]}
    after = audit_displays(result)
    if after['errors']:
        raise ValueError('Normalization did not resolve explicit display errors')
    return result, {'before':before,'after':after,'edits':edits,'new_theme_art':0,
                    'automatic_model_calls':0,'candidate_only':True}
