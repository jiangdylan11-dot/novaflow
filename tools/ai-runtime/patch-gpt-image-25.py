"""Backport ComfyUI PR 16190 model support without replacing the Runtime.

Only accepts the audited NovaFlow node. Writes a staged file, never the live
Runtime; the caller validates and installs it with an original-file backup.
Existing GPT Image 1/1.5/2 behavior and NovaFlow billing hooks are preserved.
"""
import argparse
import ast
import hashlib
from pathlib import Path

BASE_SHA256 = {
    "5b668fa3ff28d80fb39d407b2f24d0325dce5efd55407aaf9264b8f7ca49dcae",
    "b00fef6b01954ff90dae507f4670ea00b647bde1041ac1537eeee7e59039c3ad",
}


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError(f"Expected one patch anchor: {before[:80]}")
    return text.replace(before, after, 1)


def patch(raw):
    if hashlib.sha256(raw).hexdigest() not in BASE_SHA256:
        raise ValueError("Unknown Runtime node revision; review before applying")
    text = raw.decode("utf-8").replace("\r\n", "\n")
    text = replace_once(text, "def _gpt_image_shared_inputs():", "def _gpt_image_shared_inputs(qualities=None):")
    start = text.index("def _gpt_image_shared_inputs(")
    prefix, tail = text[:start], text[start:]
    tail = replace_once(tail, 'options=["low", "medium", "high"],', 'options=list(qualities or ("low", "medium", "high")),')
    tree = ast.parse(tail)
    node_class = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "OpenAIGPTImageNodeV2")
    schema = next(n for n in node_class.body if isinstance(n, ast.FunctionDef) and n.name == "define_schema")
    option = next(n for n in ast.walk(schema) if isinstance(n, ast.Call) and n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == "gpt-image-2")
    source = ast.get_source_segment(tail, option.args[1])
    # Reuse the installed size widget definitions, as the upstream backport does.
    source = source.replace('options=["auto", "opaque"]', 'options=["auto", "opaque", "transparent"]')
    source = source.replace('*_gpt_image_shared_inputs()', '*_gpt_image_shared_inputs(("low", "medium", "high", "xhigh", "max"))')
    helper = '\ndef _gpt_image_25_model_inputs():\n    return ' + source + '\n\n\n'
    tail = replace_once(tail, "class OpenAIGPTImageNodeV2(IO.ComfyNode):", helper + "class OpenAIGPTImageNodeV2(IO.ComfyNode):")
    tail = replace_once(tail, 'display_name="OpenAI GPT Image 2",', 'display_name="OpenAI GPT Image 2.5",')
    anchor = '                    options=[\n                        IO.DynamicCombo.Option('
    replacement = '''                    options=[
                        IO.DynamicCombo.Option("gpt-image-2.5-flare", _gpt_image_25_model_inputs()),
                        IO.DynamicCombo.Option("gpt-image-2.5-sunburst", _gpt_image_25_model_inputs()),
                        IO.DynamicCombo.Option('''
    tail = replace_once(tail, anchor, replacement)
    ranges = '''                    "gpt-image-2.5-flare": {
                      "low": [0.0023, 0.0283], "medium": [0.0056, 0.0636],
                      "high": [0.0222, 0.2544], "xhigh": [0.0388, 0.4523], "max": [0.0887, 1.0175]
                    },
                    "gpt-image-2.5-sunburst": {
                      "low": [0.0023, 0.0283], "medium": [0.0056, 0.0636],
                      "high": [0.0222, 0.2544], "xhigh": [0.0388, 0.4523], "max": [0.0887, 1.0175]
                    },
'''
    tail = replace_once(tail, '                    "gpt-image-2": {', ranges + '                    "gpt-image-2": {')
    tail = replace_once(tail, '        elif model_id == "gpt-image-2":', '        elif model_id in ("gpt-image-2.5-flare", "gpt-image-2.5-sunburst"):\n            price_extractor = calculate_tokens_price_image_2_5\n        elif model_id == "gpt-image-2":')
    price_helper = '''def calculate_tokens_price_image_2_5(response):
    """Official GPT Image 2.5 token rates; no estimate if usage is incomplete."""
    usage = getattr(response, "usage", None)
    details = getattr(usage, "input_tokens_details", None)
    image_tokens = getattr(details, "image_tokens", None)
    text_tokens = getattr(details, "text_tokens", None)
    output_tokens = getattr(usage, "output_tokens", None)
    input_tokens = getattr(usage, "input_tokens", None)
    values = (image_tokens, text_tokens, output_tokens, input_tokens)
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0 for v in values):
        return None
    if image_tokens + text_tokens != input_tokens:
        return None
    return (image_tokens * 8.0 + text_tokens * 5.0 + output_tokens * 30.0) / 1_000_000.0


'''
    result = prefix + price_helper + tail
    compile(result, "nodes_openai.py", "exec")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.destination.resolve():
        raise ValueError("Destination must be a separate staged file")
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    args.destination.write_text(patch(args.source.read_bytes()), encoding="utf-8", newline="\n")
    print("Staged GPT Image 2.5 node:", args.destination)
