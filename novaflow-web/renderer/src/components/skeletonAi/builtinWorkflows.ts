export const BONE_AI_SPLIT_WORKFLOW_V1_JSON = String.raw`{
  "60": {
    "inputs": {
      "filename_prefix": "Qwen-image-layers",
      "images": [
        "83:8",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "保存图像"
    }
  },
  "74": {
    "inputs": {
      "image": "input.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "82": {
    "inputs": {
      "upscale_method": "lanczos",
      "largest_size": 640,
      "image": [
        "74",
        0
      ]
    },
    "class_type": "ImageScaleToMaxDimension",
    "_meta": {
      "title": "图像缩放到最大尺寸"
    }
  },
  "83:7": {
    "inputs": {
      "text": "",
      "clip": [
        "83:38",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Negative Prompt)"
    }
  },
  "83:70": {
    "inputs": {
      "conditioning": [
        "83:7",
        0
      ],
      "latent": [
        "83:71",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "83:69": {
    "inputs": {
      "conditioning": [
        "83:6",
        0
      ],
      "latent": [
        "83:71",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "参考Latent"
    }
  },
  "83:66": {
    "inputs": {
      "shift": 1,
      "model": [
        "83:37",
        0
      ]
    },
    "class_type": "ModelSamplingAuraFlow",
    "_meta": {
      "title": "采样算法（AuraFlow）"
    }
  },
  "83:76": {
    "inputs": {
      "dim": "t",
      "slice_size": 1,
      "samples": [
        "83:3",
        0
      ]
    },
    "class_type": "LatentCutToBatch",
    "_meta": {
      "title": "Latent切割"
    }
  },
  "83:71": {
    "inputs": {
      "pixels": [
        "82",
        0
      ],
      "vae": [
        "83:39",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "83:8": {
    "inputs": {
      "samples": [
        "83:76",
        0
      ],
      "vae": [
        "83:39",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "83:6": {
    "inputs": {
      "text": "guitar",
      "clip": [
        "83:38",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Positive Prompt)"
    }
  },
  "83:3": {
    "inputs": {
      "seed": 657641993490688,
      "steps": 20,
      "cfg": 2.5,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": [
        "83:66",
        0
      ],
      "positive": [
        "83:69",
        0
      ],
      "negative": [
        "83:70",
        0
      ],
      "latent_image": [
        "83:123",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "83:78": {
    "inputs": {
      "image": [
        "82",
        0
      ]
    },
    "class_type": "GetImageSize",
    "_meta": {
      "title": "获取图像尺寸"
    }
  },
  "83:123": {
    "inputs": {
      "width": [
        "83:78",
        0
      ],
      "height": [
        "83:78",
        1
      ],
      "layers": 2,
      "batch_size": 1
    },
    "class_type": "EmptyQwenImageLayeredLatentImage",
    "_meta": {
      "title": "空Latent图像（QwenImageLayerd）"
    }
  },
  "83:37": {
    "inputs": {
      "unet_name": "qwen_image_layered_control_bf16.safetensors",
      "weight_dtype": "fp8_e4m3fn"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "UNet加载器"
    }
  },
  "83:38": {
    "inputs": {
      "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      "type": "qwen_image",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "加载CLIP"
    }
  },
  "83:39": {
    "inputs": {
      "vae_name": "qwen_image_layered_vae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "加载VAE"
    }
  }
}`
