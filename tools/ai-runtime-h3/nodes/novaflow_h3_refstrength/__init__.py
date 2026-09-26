"""Expose MiniMax H3's reference condition noise augmentation as a node.

The DiT already supports weakening a reference: `_cond_video_rows` mixes noise
into the condition latents (`r = aug*r + (1-aug)*noise`) and the packed layout
then pins those rows at timestep max(t_video, aug), so the model is told how
degraded the reference is instead of being lied to. Nothing upstream sets it,
so every ref2v generation runs at the 0.999 default - a near-clean reference,
which is why a restyle traces the source's silhouette.

Lowering it destroys the reference's fine structure first and its coarse
placement last, which is exactly the knob a "keep the motion, let the new
material find its own shape" control needs.
"""
import node_helpers

MODEL_DEFAULT = 0.999


class NovaFlowH3ReferenceStrength:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'conditioning': ('CONDITIONING',),
                'reference_strength': ('FLOAT', {
                    'default': MODEL_DEFAULT, 'min': 0.0, 'max': 1.0, 'step': 0.001,
                    'tooltip': 'Signal kept in the reference condition latents. 0.999 is the '
                               'model default (near-clean reference, silhouette is copied); '
                               'lower values trade silhouette fidelity for freedom while the '
                               'coarse path and timing survive.',
                }),
            },
            'optional': {
                'audio_reference_strength': ('FLOAT', {
                    'default': 1.0, 'min': 0.0, 'max': 1.0, 'step': 0.001,
                    'tooltip': 'Same, for reference audio. 1.0 is the model default.',
                }),
            },
        }

    RETURN_TYPES = ('CONDITIONING',)
    FUNCTION = 'apply'
    CATEGORY = 'NovaFlow/H3'
    DESCRIPTION = 'Weaken MiniMax H3 reference conditioning by noising the condition latents.'

    def apply(self, conditioning, reference_strength, audio_reference_strength=1.0):
        values = {'minimax_visual_cond_noise_aug': float(reference_strength)}
        if audio_reference_strength < 1.0:
            values['minimax_audio_cond_noise_aug'] = float(audio_reference_strength)
        return (node_helpers.conditioning_set_values(conditioning, values),)


NODE_CLASS_MAPPINGS = {'NovaFlowH3ReferenceStrength': NovaFlowH3ReferenceStrength}
NODE_DISPLAY_NAME_MAPPINGS = {'NovaFlowH3ReferenceStrength': 'H3 参考约束强度'}
