"""Resolve immutable upstream text by references; never redesign art fields.

One reference owns an entire existing art field, including its color,
material, lighting and detail. No theme/color vocabulary or text overrides.
"""
from copy import deepcopy
import hashlib,json


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def make_references(documents):
    refs={}
    for document,values in documents.items():
        refs[document]={}
        for field,value in values.items():
            if not isinstance(value,str) or not value:
                raise ValueError('An upstream art field must be a nonempty string')
            refs[document][field]={'document':document,'field':field,
                'span':[0,len(value)],'sha256':digest(value)}
    return refs


def resolve_references(references,documents):
    if set(references)!=set(documents):
        raise ValueError('Source document inventory changed')
    output={};ledger=[]
    for document,values in documents.items():
        fields=references[document]
        if set(fields)!=set(values):
            raise ValueError('Source field inventory changed')
        output[document]={}
        for field,value in values.items():
            ref=fields[field]
            if set(ref)!={'document','field','span','sha256'}:
                raise ValueError('References cannot carry replacement art text')
            if ref['document']!=document or ref['field']!=field:
                raise ValueError('Reference crossed a component boundary')
            if ref['span']!=[0,len(value)] or ref['sha256']!=digest(value):
                raise ValueError('Source changed or reference would omit attributes')
            output[document][field]=value[ref['span'][0]:ref['span'][1]]
            ledger.append({'document':document,'field':field,
                'source_span':ref['span'],'source_sha256':ref['sha256'],
                'resolved_sha256':digest(output[document][field]),
                'byte_exact':True,'art_words_added':0,'art_words_deleted':0})
    return output,ledger


def apply_to_case(case,references,documents):
    """Generic compiler entry adapter, also exercised on the old 9/20 fixtures."""
    resolved,ledger=resolve_references(references,documents)
    result=deepcopy(case)
    for document,values in resolved.items():
        if document not in ['art','fragments']:
            raise ValueError('Not a supported art namespace')
        if document in result and result[document]!=values:
            raise ValueError('Free-written art cannot override the upstream reference')
        result[document]=values
    return result,ledger
