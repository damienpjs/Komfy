/**
 * LTX 2.3 — image-to-video + audio (two-pass: First Pass then Upscale Pass).
 *
 * Standalone workflow (NOT modelled on WAN's high/low experts). The frozen
 * graph is the canonical API export of docs/ltx/ (86 nodes, validated on the
 * live server), with five surgical edits so Komfy can drive it:
 *   - the rgthree Power Lora Loader (934) is dropped → the `loras` field
 *     inserts a shared LoraLoaderModelOnly chain (986 → chain → both distilled
 *     loaders below), defaulted to the OmniNFT-RL LoRA;
 *   - the vestigial distilled nodes (easy loraNames 1163 + mxSlider 1168/1169)
 *     are replaced by two real LoraLoaderModelOnly (1164 first pass, 1165
 *     upscale pass) spliced on each sampler's model path — the `distilled`
 *     toggle drops them by passthrough-bypass (off = the LoRA is not loaded at
 *     all, for already-distilled models), the two `distilledFirst`/
 *     `distilledUpscale` numbers set their per-pass strength (0.5 default);
 *   - the two `Any Switch` (1232/1233) are dropped → each SamplerCustom reads
 *     its ManualSigmas directly (1228/1229), the `scheduler` select swaps to
 *     the BasicScheduler pair (1230/1231, added here);
 *   - the final upscale nodes (1009/1010/1155) are added, bypassed by default;
 *   - a single VHS_VideoCombine sink (1152:597) — the `interpolation` select
 *     drops RIFE and rewires the sink instead of keeping two sinks.
 *
 * Subgraph-namespaced node ids (`889:1142`, `906:1154`, `1152:597`) are the
 * real API keys, used verbatim in the patch targets. The live preview streams
 * for free (LTX2SamplingPreviewOverride 986 + taeltx VAE → WS preview frames,
 * cf. api/ws.ts). Everything validated against /object_info in docs/ltx/.
 *
 * ⚠️ The graph object is generated from docs/ltx/ltx-i2v.canonical.api.json;
 * see docs/ltx-i2v-plan.md. Edit the fields by hand; regenerate the graph if
 * the export changes.
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowManifest } from './types';

const graph: PromptGraph = {
  "1041": {
    "_meta": {
      "title": "EmptyLTXVLatentVideo"
    },
    "class_type": "EmptyLTXVLatentVideo",
    "inputs": {
      "batch_size": 1,
      "height": [
        "533",
        1
      ],
      "length": [
        "798",
        1
      ],
      "width": [
        "533",
        0
      ]
    }
  },
  "1070": {
    "_meta": {
      "title": "Video VAE Loader"
    },
    "class_type": "VAELoaderKJ",
    "inputs": {
      "device": "main_device",
      "vae_name": "LTX23_video_vae_bf16.safetensors",
      "weight_dtype": "bf16"
    }
  },
  "1072": {
    "_meta": {
      "title": "DualCLIPLoader (GGUF)"
    },
    "class_type": "DualCLIPLoaderGGUF",
    "inputs": {
      "clip_name1": "gemma-3-12b-it-abliterated.q6_k.gguf",
      "clip_name2": "ltx-2.3_text_projection_bf16.safetensors",
      "type": "ltxv"
    }
  },
  "1075": {
    "_meta": {
      "title": "Unet Loader (GGUF)"
    },
    "class_type": "UnetLoaderGGUF",
    "inputs": {
      "unet_name": "DasiwaLTX23_dragonleapV4.gguf"
    }
  },
  "1080": {
    "_meta": {
      "title": "Audio Included VAE Loader"
    },
    "class_type": "LTXVAudioVAELoader",
    "inputs": {
      "ckpt_name": "LTX23_audio_vae_bf16.safetensors"
    }
  },
  "1083": {
    "_meta": {
      "title": "Charger le Modèle d'Agrandissement Latent"
    },
    "class_type": "LatentUpscaleModelLoader",
    "inputs": {
      "model_name": "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
    }
  },
  "1084": {
    "_meta": {
      "title": "Load Preview VAE"
    },
    "class_type": "VAELoader",
    "inputs": {
      "vae_name": "taeltx2_3.safetensors"
    }
  },
  "1097": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {}
  },
  "1098": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {}
  },
  "1099": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {
      "model": [
        "1075",
        0
      ]
    }
  },
  "1100": {
    "_meta": {
      "title": "Context Switch (rgthree)"
    },
    "class_type": "Context Switch (rgthree)",
    "inputs": {
      "ctx_01": [
        "1097",
        0
      ],
      "ctx_02": [
        "1098",
        0
      ],
      "ctx_03": [
        "1099",
        0
      ]
    }
  },
  "1101": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {}
  },
  "1102": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {
      "clip": [
        "1072",
        0
      ]
    }
  },
  "1103": {
    "_meta": {
      "title": "Context Switch (rgthree)"
    },
    "class_type": "Context Switch (rgthree)",
    "inputs": {
      "ctx_01": [
        "1101",
        0
      ],
      "ctx_02": [
        "1212",
        0
      ],
      "ctx_03": [
        "1102",
        0
      ]
    }
  },
  "1104": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {
      "vae": [
        "1070",
        0
      ]
    }
  },
  "1105": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {}
  },
  "1106": {
    "_meta": {
      "title": "Context Switch (rgthree)"
    },
    "class_type": "Context Switch (rgthree)",
    "inputs": {
      "ctx_01": [
        "1104",
        0
      ],
      "ctx_02": [
        "1105",
        0
      ]
    }
  },
  "1107": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {}
  },
  "1108": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {
      "vae": [
        "1080",
        0
      ]
    }
  },
  "1109": {
    "_meta": {
      "title": "Context Switch (rgthree)"
    },
    "class_type": "Context Switch (rgthree)",
    "inputs": {
      "ctx_01": [
        "1108",
        0
      ],
      "ctx_02": [
        "1107",
        0
      ]
    }
  },
  "1110": {
    "_meta": {
      "title": "Model Patch Torch Settings"
    },
    "class_type": "ModelPatchTorchSettings",
    "inputs": {
      "enable_fp16_accumulation": true,
      "model": [
        "1100",
        1
      ]
    }
  },
  "1115": {
    "_meta": {
      "title": "🔗 LTX Reference Enable"
    },
    "class_type": "LTXReferenceEnable",
    "inputs": {
      "model": [
        "1110",
        0
      ],
      "verbose": false,
      "zero_ref_timesteps": false
    }
  },
  "1137": {
    "_meta": {
      "title": "Target Frame Rate"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 48,
      "Xi": 48,
      "isfloatX": 1
    }
  },
  "1138": {
    "_meta": {
      "title": "Base Frame Rate (24 Default)"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 24,
      "Xi": 24,
      "isfloatX": 1
    }
  },
  "1139": {
    "_meta": {
      "title": "Audio Volume (+6 Double, -6 Half)"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 0,
      "Xi": 0,
      "isfloatX": 0
    }
  },
  "1152:1158": {
    "_meta": {
      "title": "Prune Outputs 🎥🅥🅗🅢"
    },
    "class_type": "VHS_PruneOutputs",
    "inputs": {
      "filenames": [
        "1152:597",
        0
      ],
      "options": "Intermediate"
    }
  },
  "1152:1237": {
    "_meta": {
      "title": "Save last frame"
    },
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "komfy/ltx-i2v-lastframe",
      "images": [
        "1152:1238",
        0
      ]
    }
  },
  "1152:1238": {
    "_meta": {
      "title": "Last frame"
    },
    "class_type": "ImageFromBatch",
    "inputs": {
      "batch_index": 999,
      "image": [
        "906:1154",
        0
      ],
      "length": 1
    }
  },
  "1152:597": {
    "_meta": {
      "title": "Video Combine 🎥🅥🅗🅢"
    },
    "class_type": "VHS_VideoCombine",
    "inputs": {
      "audio": [
        "906:905",
        0
      ],
      "crf": 19,
      "filename_prefix": "komfy/ltx-i2v",
      "format": "video/h264-mp4",
      "frame_rate": [
        "1137",
        0
      ],
      "images": [
        "1152:835",
        0
      ],
      "loop_count": 0,
      "pingpong": null,
      "pix_fmt": "yuv420p",
      "save_metadata": true,
      "save_output": true,
      "trim_to_audio": false
    }
  },
  "1152:835": {
    "_meta": {
      "title": "RIFE VFI (frame-interpolation)"
    },
    "class_type": "RIFE VFI",
    "inputs": {
      "batch_size": 1,
      "ckpt_name": "rife49.pth",
      "clear_cache_after_n_frames": 10,
      "dtype": "float32",
      "ensemble": true,
      "fast_mode": true,
      "frames": [
        "906:1154",
        0
      ],
      "multiplier": 2,
      "scale_factor": 1,
      "torch_compile": false
    }
  },
  "1164": {
    "_meta": {
      "title": "Distilled LoRA (first pass)"
    },
    "class_type": "LoraLoaderModelOnly",
    "inputs": {
      "model": [
        "986",
        0
      ],
      "lora_name": "ltx/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
      "strength_model": 0.5
    }
  },
  "1165": {
    "_meta": {
      "title": "Distilled LoRA (upscale pass)"
    },
    "class_type": "LoraLoaderModelOnly",
    "inputs": {
      "model": [
        "986",
        0
      ],
      "lora_name": "ltx/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
      "strength_model": 0.5
    }
  },
  "1177": {
    "_meta": {
      "title": "Base Height"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 1344,
      "Xi": 1344,
      "isfloatX": 0
    }
  },
  "1178": {
    "_meta": {
      "title": "Upscale Width"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 1080,
      "Xi": 1080,
      "isfloatX": 0
    }
  },
  "1179": {
    "_meta": {
      "title": "Upscale Height"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 1920,
      "Xi": 1920,
      "isfloatX": 0
    }
  },
  "1180": {
    "_meta": {
      "title": "Base Width"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 768,
      "Xi": 768,
      "isfloatX": 0
    }
  },
  "1182": {
    "_meta": {
      "title": "Basic Scheduler First Steps"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 10,
      "Xi": 10,
      "isfloatX": 0
    }
  },
  "1183": {
    "_meta": {
      "title": "Basic Scheduler Upscale Steps"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 4,
      "Xi": 4,
      "isfloatX": 0
    }
  },
  "1212": {
    "_meta": {
      "title": "Context (rgthree)"
    },
    "class_type": "Context (rgthree)",
    "inputs": {}
  },
  "1213": {
    "_meta": {
      "title": "LTXV Preprocess First"
    },
    "class_type": "LTXVPreprocess",
    "inputs": {
      "image": [
        "531",
        0
      ],
      "img_compression": 18
    }
  },
  "1214": {
    "_meta": {
      "title": "LTXV Preprocess Upscale"
    },
    "class_type": "LTXVPreprocess",
    "inputs": {
      "image": [
        "531",
        0
      ],
      "img_compression": 18
    }
  },
  "1228": {
    "_meta": {
      "title": "Sigmas First Pass"
    },
    "class_type": "ManualSigmas",
    "inputs": {
      "sigmas": "1.000, 0.955, 0.893, 0.812, 0.715, 0.603, 0.482, 0.241, 0.121, 0.0"
    }
  },
  "1229": {
    "_meta": {
      "title": "Sigmas Upscale"
    },
    "class_type": "ManualSigmas",
    "inputs": {
      "sigmas": "0.92, 0.725, 0.421875, 0.0"
    }
  },
  "1234": {
    "_meta": {
      "title": "CLIP Text Encode (Prompt)"
    },
    "class_type": "CLIPTextEncode",
    "inputs": {
      "clip": [
        "1103",
        2
      ],
      "text": ""
    }
  },
  "524": {
    "_meta": {
      "title": "Seed (rgthree)"
    },
    "class_type": "Seed (rgthree)",
    "inputs": {
      "seed": 12345
    }
  },
  "531": {
    "_meta": {
      "title": "Resize Image v2"
    },
    "class_type": "ImageResizeKJv2",
    "inputs": {
      "crop_position": "center",
      "device": "cpu",
      "divisible_by": 32,
      "height": [
        "1177",
        0
      ],
      "image": [
        "885",
        0
      ],
      "keep_proportion": "resize",
      "pad_color": "0, 0, 0",
      "upscale_method": "lanczos",
      "width": [
        "1180",
        0
      ]
    }
  },
  "532": {
    "_meta": {
      "title": "Redimensionner image/masque"
    },
    "class_type": "ResizeImageMaskNode",
    "inputs": {
      "input": [
        "1213",
        0
      ],
      "resize_type": "scale by multiplier",
      "resize_type.multiplier": 0.5,
      "scale_method": "area"
    }
  },
  "533": {
    "_meta": {
      "title": "Obtenir la taille de l'image"
    },
    "class_type": "GetImageSize",
    "inputs": {
      "image": [
        "532",
        0
      ]
    }
  },
  "537": {
    "_meta": {
      "title": "CLIP Text Encode (Prompt)"
    },
    "class_type": "CLIPTextEncode",
    "inputs": {
      "clip": [
        "1103",
        2
      ],
      "text": "background music, noise, white noise, bleep, still image, bad quality, subtitles, text, watermark, overlay effects, pc game, yelling, console game, video game, cartoon, childish, ugly, text, blur, logo, wordmark, static, low quality, censoring, censor, bleeping, beep, beeping, newscast, interview, podcast,  mutant, horror, slow-motion"
    }
  },
  "540": {
    "_meta": {
      "title": "FloatToInt"
    },
    "class_type": "CM_FloatToInt",
    "inputs": {
      "a": [
        "1138",
        0
      ]
    }
  },
  "796": {
    "_meta": {
      "title": "Length (Seconds)"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 7,
      "Xi": 7,
      "isfloatX": 0
    }
  },
  "797": {
    "_meta": {
      "title": "First Frame Strength"
    },
    "class_type": "mxSlider",
    "inputs": {
      "Xf": 0.95,
      "Xi": 0,
      "isfloatX": 1
    }
  },
  "798": {
    "_meta": {
      "title": "Expression mathématique"
    },
    "class_type": "ComfyMathExpression",
    "inputs": {
      "expression": "a*b+1",
      "values.a": [
        "796",
        0
      ],
      "values.b": [
        "1138",
        0
      ]
    }
  },
  "885": {
    "_meta": {
      "title": "Charger Image"
    },
    "class_type": "LoadImage",
    "inputs": {
      "image": ""
    }
  },
  "889:1114": {
    "_meta": {
      "title": "🎴 LTX Reference Conditioning"
    },
    "class_type": "LTXReferenceConditioning",
    "inputs": {
      "image": [
        "532",
        0
      ],
      "model": [
        "889:992",
        0
      ],
      "position_mode": "reference",
      "strength": 1,
      "target_latent": [
        "889:772",
        0
      ],
      "vae": [
        "1106",
        3
      ],
      "verbose": false
    }
  },
  "889:1142": {
    "_meta": {
      "title": "First Pass"
    },
    "class_type": "SamplerCustom",
    "inputs": {
      "add_noise": true,
      "cfg": 1,
      "latent_image": [
        "889:548",
        0
      ],
      "model": [
        "889:1114",
        0
      ],
      "negative": [
        "889:523",
        1
      ],
      "noise_seed": [
        "524",
        0
      ],
      "positive": [
        "889:523",
        0
      ],
      "sampler": [
        "889:1145",
        0
      ],
      "sigmas": [
        "1228",
        0
      ]
    }
  },
  "889:1145": {
    "_meta": {
      "title": "KSamplerSelect (First)"
    },
    "class_type": "KSamplerSelect",
    "inputs": {
      "sampler_name": "euler_ancestral"
    }
  },
  "889:523": {
    "_meta": {
      "title": "LTXVConditioning"
    },
    "class_type": "LTXVConditioning",
    "inputs": {
      "frame_rate": [
        "1138",
        0
      ],
      "negative": [
        "537",
        0
      ],
      "positive": [
        "1234",
        0
      ]
    }
  },
  "889:535": {
    "_meta": {
      "title": "Audio latent vide LTXV"
    },
    "class_type": "LTXVEmptyLatentAudio",
    "inputs": {
      "audio_vae": [
        "1109",
        3
      ],
      "batch_size": 1,
      "frame_rate": [
        "540",
        0
      ],
      "frames_number": [
        "798",
        1
      ]
    }
  },
  "889:548": {
    "_meta": {
      "title": "Concaténation AV Latent LTXV"
    },
    "class_type": "LTXVConcatAVLatent",
    "inputs": {
      "audio_latent": [
        "889:535",
        0
      ],
      "video_latent": [
        "889:772",
        0
      ]
    }
  },
  "889:549": {
    "_meta": {
      "title": "Video Combine 🎥🅥🅗🅢"
    },
    "class_type": "VHS_VideoCombine",
    "inputs": {
      "audio": [
        "889:551",
        0
      ],
      "crf": 19,
      "filename_prefix": "komfy/ltx-i2v-pass1",
      "format": "video/h264-mp4",
      "frame_rate": [
        "1138",
        0
      ],
      "images": [
        "889:552",
        0
      ],
      "loop_count": 0,
      "pingpong": null,
      "pix_fmt": "yuv420p",
      "save_metadata": true,
      "save_output": true,
      "trim_to_audio": false
    }
  },
  "889:550": {
    "_meta": {
      "title": "Décodage Audio VAE LTXV"
    },
    "class_type": "LTXVAudioVAEDecode",
    "inputs": {
      "audio_vae": [
        "1109",
        3
      ],
      "samples": [
        "889:556",
        1
      ]
    }
  },
  "889:551": {
    "_meta": {
      "title": "Ajuster le Volume Audio"
    },
    "class_type": "AudioAdjustVolume",
    "inputs": {
      "audio": [
        "889:550",
        0
      ],
      "volume": 0
    }
  },
  "889:552": {
    "_meta": {
      "title": "VAE Decode"
    },
    "class_type": "VAEDecode",
    "inputs": {
      "samples": [
        "889:970",
        2
      ],
      "vae": [
        "1106",
        3
      ]
    }
  },
  "889:556": {
    "_meta": {
      "title": "LTXVSeparateAVLatent"
    },
    "class_type": "LTXVSeparateAVLatent",
    "inputs": {
      "av_latent": [
        "889:1142",
        1
      ]
    }
  },
  "889:772": {
    "_meta": {
      "title": "LTXVImgToVideoInplaceKJ"
    },
    "class_type": "LTXVImgToVideoInplaceKJ",
    "inputs": {
      "latent": [
        "1041",
        0
      ],
      "num_images": "1",
      "num_images.image_1": [
        "532",
        0
      ],
      "num_images.index_1": 0,
      "num_images.strength_1": [
        "797",
        0
      ],
      "vae": [
        "1106",
        3
      ]
    }
  },
  "889:970": {
    "_meta": {
      "title": "LTXVCropGuides"
    },
    "class_type": "LTXVCropGuides",
    "inputs": {
      "latent": [
        "889:556",
        0
      ],
      "negative": [
        "889:523",
        1
      ],
      "positive": [
        "889:523",
        0
      ]
    }
  },
  "889:992": {
    "_meta": {
      "title": "LTX2 NAG"
    },
    "class_type": "LTX2_NAG",
    "inputs": {
      "inplace": true,
      "model": [
        "1164",
        0
      ],
      "nag_alpha": 0.25,
      "nag_cond_audio": [
        "537",
        0
      ],
      "nag_cond_video": [
        "537",
        0
      ],
      "nag_scale": 11,
      "nag_tau": 2.5
    }
  },
  "906:1000": {
    "_meta": {
      "title": "LTX2 NAG"
    },
    "class_type": "LTX2_NAG",
    "inputs": {
      "inplace": true,
      "model": [
        "1165",
        0
      ],
      "nag_alpha": 0.25,
      "nag_cond_audio": [
        "889:970",
        1
      ],
      "nag_cond_video": [
        "889:970",
        1
      ],
      "nag_scale": 11,
      "nag_tau": 2.5
    }
  },
  "906:1024": {
    "_meta": {
      "title": "LTXVCropGuides"
    },
    "class_type": "LTXVCropGuides",
    "inputs": {
      "latent": [
        "906:902",
        0
      ],
      "negative": [
        "889:970",
        1
      ],
      "positive": [
        "889:970",
        0
      ]
    }
  },
  "906:1052": {
    "_meta": {
      "title": "LTX Latent Upsampler (natif)"
    },
    "class_type": "LTXVLatentUpsampler",
    "inputs": {
      "samples": [
        "889:556",
        0
      ],
      "upscale_model": [
        "1083",
        0
      ],
      "vae": [
        "1106",
        3
      ]
    }
  },
  "906:1141": {
    "_meta": {
      "title": "Upscale Pass"
    },
    "class_type": "SamplerCustom",
    "inputs": {
      "add_noise": true,
      "cfg": 1,
      "latent_image": [
        "906:900",
        0
      ],
      "model": [
        "906:1150",
        0
      ],
      "negative": [
        "889:970",
        1
      ],
      "noise_seed": [
        "524",
        0
      ],
      "positive": [
        "889:970",
        0
      ],
      "sampler": [
        "906:1147",
        0
      ],
      "sigmas": [
        "1229",
        0
      ]
    }
  },
  "906:1147": {
    "_meta": {
      "title": "KSamplerSelect (Upscale)"
    },
    "class_type": "KSamplerSelect",
    "inputs": {
      "sampler_name": "euler_ancestral_cfg_pp"
    }
  },
  "906:1150": {
    "_meta": {
      "title": "🎴 LTX Reference Conditioning"
    },
    "class_type": "LTXReferenceConditioning",
    "inputs": {
      "image": [
        "1214",
        0
      ],
      "model": [
        "906:1000",
        0
      ],
      "position_mode": "reference",
      "strength": 1,
      "target_latent": [
        "906:896",
        0
      ],
      "vae": [
        "1106",
        3
      ],
      "verbose": false
    }
  },
  "906:1154": {
    "_meta": {
      "title": "🅛🅣🅧 LTXV Tiled VAE Decode"
    },
    "class_type": "LTXVTiledVAEDecode",
    "inputs": {
      "horizontal_tiles": 4,
      "last_frame_fix": false,
      "latents": [
        "906:961",
        0
      ],
      "overlap": 8,
      "vae": [
        "1106",
        3
      ],
      "vertical_tiles": 4,
      "working_device": "auto",
      "working_dtype": "auto"
    }
  },
  "906:896": {
    "_meta": {
      "title": "LTXVImgToVideoInplaceKJ"
    },
    "class_type": "LTXVImgToVideoInplaceKJ",
    "inputs": {
      "latent": [
        "906:1052",
        0
      ],
      "num_images": "1",
      "num_images.image_1": [
        "1214",
        0
      ],
      "num_images.index_1": 0,
      "num_images.strength_1": 1,
      "vae": [
        "1106",
        3
      ]
    }
  },
  "906:900": {
    "_meta": {
      "title": "Concaténation AV Latent LTXV"
    },
    "class_type": "LTXVConcatAVLatent",
    "inputs": {
      "audio_latent": [
        "889:556",
        1
      ],
      "video_latent": [
        "906:896",
        0
      ]
    }
  },
  "906:902": {
    "_meta": {
      "title": "LTXVSeparateAVLatent"
    },
    "class_type": "LTXVSeparateAVLatent",
    "inputs": {
      "av_latent": [
        "906:1141",
        1
      ]
    }
  },
  "906:904": {
    "_meta": {
      "title": "Décodage Audio VAE LTXV"
    },
    "class_type": "LTXVAudioVAEDecode",
    "inputs": {
      "audio_vae": [
        "1109",
        3
      ],
      "samples": [
        "906:902",
        1
      ]
    }
  },
  "906:905": {
    "_meta": {
      "title": "Ajuster le Volume Audio"
    },
    "class_type": "AudioAdjustVolume",
    "inputs": {
      "audio": [
        "906:904",
        0
      ],
      "volume": 0
    }
  },
  "906:961": {
    "_meta": {
      "title": "Clean VRAM Used"
    },
    "class_type": "easy cleanGpuUsed",
    "inputs": {
      "anything": [
        "906:1024",
        2
      ]
    }
  },
  "986": {
    "_meta": {
      "title": "LTX2 Sampling Preview Override"
    },
    "class_type": "LTX2SamplingPreviewOverride",
    "inputs": {
      "model": [
        "1115",
        0
      ],
      "preview_rate": [
        "540",
        0
      ],
      "vae": [
        "1084",
        0
      ]
    }
  },
  "1009": {
    "class_type": "UpscaleModelLoader",
    "inputs": {
      "model_name": "4x-UltraSharp.pth"
    }
  },
  "1010": {
    "class_type": "ImageUpscaleWithModel",
    "inputs": {
      "image": [
        "906:1154",
        0
      ],
      "upscale_model": [
        "1009",
        0
      ]
    }
  },
  "1155": {
    "class_type": "ImageScale",
    "inputs": {
      "image": [
        "1010",
        0
      ],
      "upscale_method": "lanczos",
      "width": 1080,
      "height": 1920,
      "crop": "center"
    }
  },
  "1230": {
    "class_type": "BasicScheduler",
    "inputs": {
      "model": [
        "986",
        0
      ],
      "scheduler": "linear_quadratic",
      "steps": 10,
      "denoise": 1
    }
  },
  "1231": {
    "class_type": "BasicScheduler",
    "inputs": {
      "model": [
        "986",
        0
      ],
      "scheduler": "linear_quadratic",
      "steps": 4,
      "denoise": 0.42
    }
  }
};

export const ltxI2v: WorkflowManifest = {
  id: 'ltx-i2v',
  name: 'wf.ltx.name',
  description: 'wf.ltx.description',
  icon: 'videocam-outline',
  graph,
  saveNodeId: '1152:597',
  auxSaveNodeIds: ['889:549', '1152:1237'],
  fields: [
    {
      "kind": "image",
      "key": "image",
      "label": "wf.common.sourceImage",
      "target": {
        "nodeId": "885",
        "input": "image"
      },
      "required": true
    },
    {
      "kind": "text",
      "key": "prompt",
      "label": "Prompt",
      "target": {
        "nodeId": "1234",
        "input": "text"
      },
      "default": "",
      "placeholder": "wf.ltx.promptPlaceholder",
      "multiline": true,
      "required": true
    },
    {
      "kind": "text",
      "key": "negative",
      "label": "wf.common.negativePrompt",
      "target": {
        "nodeId": "537",
        "input": "text"
      },
      "default": "background music, noise, white noise, bleep, still image, bad quality, subtitles, text, watermark, overlay effects, pc game, yelling, console game, video game, cartoon, childish, ugly, text, blur, logo, wordmark, static, low quality, censoring, censor, bleeping, beep, beeping, newscast, interview, podcast,  mutant, horror, slow-motion",
      "placeholder": "wf.common.negativePlaceholder",
      "multiline": true
    },
    {
      "kind": "dimensions",
      "key": "format",
      "label": "wf.common.dimensions",
      "widthTarget": {
        "nodeId": "531",
        "input": "width"
      },
      "heightTarget": {
        "nodeId": "531",
        "input": "height"
      },
      "options": [
        {
          "width": 768,
          "height": 1344
        },
        {
          "width": 576,
          "height": 1024
        },
        {
          "width": 1024,
          "height": 1536
        }
      ],
      "default": {
        "width": 768,
        "height": 1344
      }
    },
    {
      "kind": "number",
      "key": "duration",
      "label": "wf.ltx.duration",
      "target": {
        "nodeId": "796",
        "input": "Xi"
      },
      "extraTargets": [
        {
          "nodeId": "796",
          "input": "Xf"
        }
      ],
      "default": 7,
      "min": 1,
      "max": 40,
      "integer": true,
      "hint": "wf.ltx.durationHint"
    },
    {
      "kind": "number",
      "key": "fps",
      "label": "FPS",
      "target": {
        "nodeId": "1138",
        "input": "Xf"
      },
      "extraTargets": [
        {
          "nodeId": "1138",
          "input": "Xi"
        }
      ],
      "default": 24,
      "min": 1,
      "max": 60,
      "integer": true,
      "hint": "wf.ltx.fpsHint"
    },
    {
      "kind": "number",
      "key": "targetFps",
      "label": "wf.ltx.targetFps",
      "target": {
        "nodeId": "1137",
        "input": "Xf"
      },
      "extraTargets": [
        {
          "nodeId": "1137",
          "input": "Xi"
        }
      ],
      "default": 48,
      "min": 1,
      "max": 120,
      "integer": true,
      "hint": "wf.ltx.targetFpsHint"
    },
    {
      "kind": "number",
      "key": "firstFrameStrength",
      "label": "wf.ltx.firstFrameStrength",
      "target": {
        "nodeId": "797",
        "input": "Xf"
      },
      "extraTargets": [
        {
          "nodeId": "797",
          "input": "Xi"
        }
      ],
      "default": 0.95,
      "min": 0,
      "max": 1,
      "hint": "wf.ltx.firstFrameStrengthHint"
    },
    {
      "kind": "number",
      "key": "audioVolume",
      "label": "wf.ltx.audioVolume",
      "target": {
        "nodeId": "889:551",
        "input": "volume"
      },
      "extraTargets": [
        {
          "nodeId": "906:905",
          "input": "volume"
        }
      ],
      "default": 0,
      "min": -20,
      "max": 20,
      "integer": true,
      "hint": "wf.ltx.audioVolumeHint"
    },
    {
      "kind": "model",
      "key": "model",
      "label": "wf.ltx.model",
      "target": {
        "nodeId": "1075",
        "input": "unet_name"
      },
      "default": "DasiwaLTX23_dragonleapV4.gguf",
      "remember": true,
      "hint": "wf.ltx.modelHint"
    },
    {
      "kind": "model",
      "key": "clip",
      "label": "wf.ltx.clip",
      "target": {
        "nodeId": "1072",
        "input": "clip_name1"
      },
      "default": "gemma-3-12b-it-abliterated.q6_k.gguf",
      "remember": true,
      "hint": "wf.ltx.clipHint"
    },
    {
      "kind": "model",
      "key": "vae",
      "label": "wf.ltx.vae",
      "target": {
        "nodeId": "1070",
        "input": "vae_name"
      },
      "default": "LTX23_video_vae_bf16.safetensors",
      "remember": true
    },
    {
      "kind": "model",
      "key": "audioVae",
      "label": "wf.ltx.audioVae",
      "target": {
        "nodeId": "1080",
        "input": "ckpt_name"
      },
      "default": "LTX23_audio_vae_bf16.safetensors",
      "remember": true
    },
    {
      "kind": "model",
      "key": "upscaleModel",
      "label": "wf.ltx.upscaleModel",
      "target": {
        "nodeId": "1009",
        "input": "model_name"
      },
      "default": "4x-UltraSharp.pth",
      "remember": true,
      "hint": "wf.ltx.upscaleModelHint"
    },
    {
      "kind": "loras",
      "key": "loras",
      "label": "wf.ltx.loras",
      "hint": "wf.common.lorasHint",
      "modelSource": {
        "nodeId": "986",
        "output": 0
      },
      "modelTargets": [
        {
          "nodeId": "1164",
          "input": "model"
        },
        {
          "nodeId": "1165",
          "input": "model"
        }
      ],
      "defaultStrength": 0.8,
      "default": [
        {
          "name": "ltx/LTX-2.3-OmniNFT-RL-Lora_bf16.safetensors",
          "strength": 0.8
        }
      ]
    },
    {
      "kind": "select",
      "key": "distilled",
      "label": "wf.ltx.distilled",
      "hint": "wf.ltx.distilledHint",
      "defaultIndex": 0,
      "remember": true,
      "options": [
        {
          "label": "wf.ltx.distilledOn",
          "patches": []
        },
        {
          "label": "wf.ltx.distilledOff",
          "patches": [],
          "passthroughNodes": [
            {
              "nodeId": "1164",
              "output": 0,
              "input": "model"
            },
            {
              "nodeId": "1165",
              "output": 0,
              "input": "model"
            }
          ]
        }
      ]
    },
    {
      "kind": "number",
      "key": "distilledFirst",
      "label": "wf.ltx.distilledFirst",
      "target": {
        "nodeId": "1164",
        "input": "strength_model"
      },
      "default": 0.5,
      "min": 0,
      "max": 2,
      "hint": "wf.ltx.distilledFirstHint",
      "showWhen": {
        "key": "distilled",
        "equals": 0
      }
    },
    {
      "kind": "number",
      "key": "distilledUpscale",
      "label": "wf.ltx.distilledUpscale",
      "target": {
        "nodeId": "1165",
        "input": "strength_model"
      },
      "default": 0.5,
      "min": 0,
      "max": 2,
      "hint": "wf.ltx.distilledUpscaleHint",
      "showWhen": {
        "key": "distilled",
        "equals": 0
      }
    },
    {
      "kind": "select",
      "key": "scheduler",
      "label": "wf.ltx.scheduler",
      "hint": "wf.ltx.schedulerHint",
      "defaultIndex": 0,
      "remember": true,
      "options": [
        {
          "label": "wf.ltx.schedulerSigmas",
          "patches": [],
          "bypassNodes": [
            "1230",
            "1231"
          ]
        },
        {
          "label": "wf.ltx.schedulerSteps",
          "patches": [
            {
              "target": {
                "nodeId": "889:1142",
                "input": "sigmas"
              },
              "value": [
                "1230",
                0
              ]
            },
            {
              "target": {
                "nodeId": "906:1141",
                "input": "sigmas"
              },
              "value": [
                "1231",
                0
              ]
            }
          ],
          "bypassNodes": [
            "1228",
            "1229"
          ]
        }
      ]
    },
    {
      "kind": "text",
      "key": "upscaleSigmas",
      "label": "wf.ltx.upscaleSigmas",
      "target": {
        "nodeId": "1229",
        "input": "sigmas"
      },
      "default": "0.92, 0.725, 0.421875, 0.0",
      "placeholder": "0.92, 0.725, 0.421875, 0.0",
      "required": true,
      "hint": "wf.ltx.upscaleSigmasHint",
      "showWhen": {
        "key": "scheduler",
        "equals": 0
      }
    },
    {
      "kind": "number",
      "key": "upscaleSteps",
      "label": "wf.ltx.upscaleSteps",
      "target": {
        "nodeId": "1231",
        "input": "steps"
      },
      "default": 4,
      "min": 1,
      "max": 30,
      "integer": true,
      "hint": "wf.ltx.upscaleStepsHint",
      "showWhen": {
        "key": "scheduler",
        "equals": 1
      }
    },
    {
      "kind": "number",
      "key": "upscaleDenoise",
      "label": "wf.ltx.upscaleDenoise",
      "target": {
        "nodeId": "1231",
        "input": "denoise"
      },
      "default": 0.42,
      "min": 0.05,
      "max": 1,
      "hint": "wf.ltx.upscaleDenoiseHint",
      "showWhen": {
        "key": "scheduler",
        "equals": 1
      }
    },
    {
      "kind": "select",
      "key": "upscale",
      "label": "wf.ltx.finalUpscale",
      "hint": "wf.ltx.finalUpscaleHint",
      "defaultIndex": 0,
      "remember": true,
      "options": [
        {
          "label": "wf.ltx.finalUpscaleOff",
          "patches": [],
          "bypassNodes": [
            "1009",
            "1010",
            "1155"
          ]
        },
        {
          "label": "wf.ltx.finalUpscaleOn",
          "patches": [
            {
              "target": {
                "nodeId": "1152:835",
                "input": "frames"
              },
              "value": [
                "1155",
                0
              ]
            },
            {
              "target": {
                "nodeId": "1152:1238",
                "input": "image"
              },
              "value": [
                "1155",
                0
              ]
            }
          ]
        }
      ]
    },
    {
      "kind": "select",
      "key": "interpolation",
      "label": "wf.ltx.interpolation",
      "hint": "wf.ltx.interpolationHint",
      "defaultIndex": 0,
      "remember": true,
      "options": [
        {
          "label": "wf.ltx.interpOn",
          "patches": []
        },
        {
          "label": "wf.ltx.interpOff",
          "patches": [
            {
              "target": {
                "nodeId": "1152:597",
                "input": "images"
              },
              "value": [
                "906:1154",
                0
              ]
            },
            {
              "target": {
                "nodeId": "1152:597",
                "input": "frame_rate"
              },
              "value": [
                "1138",
                0
              ]
            }
          ],
          "bypassNodes": [
            "1152:835"
          ]
        }
      ]
    },
    {
      "kind": "select",
      "key": "lastFrame",
      "label": "wf.ltx.lastFrame",
      "hint": "wf.ltx.lastFrameHint",
      "defaultIndex": 0,
      "remember": true,
      "options": [
        {
          "label": "wf.ltx.lastFrameOff",
          "patches": [],
          "bypassNodes": [
            "1152:1237",
            "1152:1238"
          ]
        },
        {
          "label": "wf.ltx.lastFrameOn",
          "patches": []
        }
      ]
    },
    {
      "kind": "seed",
      "key": "seed",
      "label": "Seed",
      "target": {
        "nodeId": "524",
        "input": "seed"
      }
    }
  ],
};
