"""Per-model attention override. Does not alter weights, sampling or global state."""
import logging


class NovaFlowH3SageAttention:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'model': ('MODEL',)}}

    RETURN_TYPES = ('MODEL',)
    FUNCTION = 'apply'
    CATEGORY = 'NovaFlow/H3'
    DESCRIPTION = 'Use SageAttention for this H3 model only; sampler and weights stay unchanged.'

    def apply(self, model):
        from comfy.ldm.modules import attention
        import sageattention  # Fail before sampling if runtime dependency is missing.
        import triton
        if not callable(attention.get_attention_function('sage', None)):
            raise RuntimeError('H3 SageAttention dependencies were installed after startup; restart the H3 runtime.')
        config = getattr(getattr(model.model, 'model_config', None), 'unet_config', {})
        if config.get('image_model') != 'minimax_h3':
            raise ValueError('NovaFlowH3SageAttention only accepts MiniMax H3 models')
        patched = model.clone()
        transformer = patched.model_options.setdefault('transformer_options', {})
        if transformer.get('optimized_attention_override') is not None:
            raise ValueError('An attention override already exists; disable it before enabling H3 SageAttention')
        sage = attention.get_attention_function('sage')

        def override(original, *args, **kwargs):
            # ComfyUI's wrapper carries _inside_attn_wrapper, preventing recursion.
            return sage(*args, **kwargs)

        transformer['optimized_attention_override'] = override
        logging.info('[NovaFlow H3] SageAttention enabled for this model; steps and weights unchanged')
        return (patched,)


NODE_CLASS_MAPPINGS = {'NovaFlowH3SageAttention': NovaFlowH3SageAttention}
NODE_DISPLAY_NAME_MAPPINGS = {'NovaFlowH3SageAttention': 'H3 SageAttention 加速'}
