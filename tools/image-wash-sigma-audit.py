"""Report the actual beta schedule used by the installed ComfyUI sampler (CPU only)."""
import json
from pathlib import Path
import sys

COMFY = Path(r'C:\ProgramData\NovaFlow\AI-Runtime\engine\ComfyUI')
sys.path.insert(0, str(COMFY))
import comfy.model_sampling
import numpy as np
from scipy.stats import beta


def schedule(shift, steps, denoise):
    model = comfy.model_sampling.ModelSamplingDiscreteFlow()
    model.set_parameters(shift=shift)
    # Identical index selection to comfy.samplers.beta_scheduler. Avoid importing
    # samplers itself because that initializes GPU management in this CPU audit.
    count = int(steps / denoise)
    indices = np.rint(beta.ppf(1 - np.linspace(0, 1, count, endpoint=False), .6, .6) * (len(model.sigmas) - 1))
    unique = list(dict.fromkeys(int(i) for i in indices))
    sigmas = ([float(model.sigmas[i]) for i in unique] + [0.0])[-(steps + 1):]
    return {'shift': shift, 'steps': steps, 'denoise': denoise,
            'startSigma': sigmas[0], 'actualSteps': len(sigmas) - 1, 'sigmas': sigmas}


if __name__ == '__main__':
    result = {'scheduler': 'beta', 'implementation': str(COMFY / 'comfy/samplers.py'),
              'cases': [schedule(shift, 20, strength) for shift in (8, 1) for strength in (.2, .65)]}
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps([{k: v for k, v in case.items() if k != 'sigmas'} for case in result['cases']], indent=2))
