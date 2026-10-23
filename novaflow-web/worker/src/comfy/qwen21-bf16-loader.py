"""Read full precision GGUF weights as native torch tensors, without requantizing."""
import logging
import math
import warnings
import torch
import folder_paths
import nodes

class NovaFlowGGUFBF16Loader:
    @classmethod
    def INPUT_TYPES(cls):
        loader = nodes.NODE_CLASS_MAPPINGS.get('UnetLoaderGGUF')
        return loader.INPUT_TYPES() if loader else {'required': {'unet_name': ([],)}}
    RETURN_TYPES = ('MODEL',)
    FUNCTION = 'load_model'
    CATEGORY = 'NovaFlow/model'

    def load_model(self, unet_name):
        import comfy.sd
        import gguf
        path = folder_paths.get_full_path_or_raise('unet', unet_name)
        reader = gguf.GGUFReader(path)
        converted = {}
        for tensor in reader.tensors:
            if tensor.tensor_type != gguf.GGMLQuantizationType.BF16:
                raise ValueError('BF16 GGUF loader requires entirely BF16 weights; got '+str(tensor.tensor_type))
            field = reader.get_field('comfy.gguf.orig_shape.'+tensor.name)
            shape = tuple(int(field.parts[i][0]) for i in field.data) if field else tuple(int(n) for n in reversed(tensor.shape))
            if tensor.data.nbytes != math.prod(shape)*2:
                raise ValueError('Invalid BF16 tensor size: '+tensor.name)
            with warnings.catch_warnings():
                warnings.filterwarnings('ignore', message='The given NumPy array is not writable')
                base = torch.from_numpy(tensor.data)
            converted[tensor.name] = base.view(torch.bfloat16).reshape(shape)
        logging.info('NovaFlow BF16 GGUF: native tensor views, no quantization; %s tensors', len(converted))
        model = comfy.sd.load_diffusion_model_state_dict(converted, model_options={'dtype':torch.bfloat16})
        if model is None:
            raise ValueError('Unsupported BF16 GGUF diffusion model')
        return (model,)

NODE_CLASS_MAPPINGS = {'NovaFlowGGUFBF16Loader':NovaFlowGGUFBF16Loader}
NODE_DISPLAY_NAME_MAPPINGS = {'NovaFlowGGUFBF16Loader':'NovaFlow BF16 GGUF Loader'}
