"""`ltx-2-mlx a2v` with LoRAs fused into the transformer (Komfy).

The a2v subcommand of ltx-2-mlx 0.18 has no `--lora` flag, but its
pipelines fuse whatever sits in `self._pending_loras` when they load the
transformer (the mechanism `generate` and `ic-lora` use, a list of
(path, strength) fused together). This wrapper sets that list right after
the pipeline is built, then hands the remaining arguments to the regular
CLI. The run log shows one "Fusing LoRA" line per LoRA when it took.

Run with the ltx-2-mlx virtualenv's python, one PATH STRENGTH pair per LoRA:
  python a2v_lora.py LORA STRENGTH [LORA STRENGTH ...] -- <a2v arguments>
"""

import sys

from ltx_pipelines_mlx import a2vid_distilled, a2vid_two_stage, cli


def _patch(cls, loras):
    original = cls.__init__

    def init(self, *args, **kwargs):
        original(self, *args, **kwargs)
        self._pending_loras = list(loras)
        for lora, strength in loras:
            print(f"Pending LoRA: {lora} ({strength})", flush=True)

    cls.__init__ = init


def _parse(pairs):
    if not pairs or len(pairs) % 2:
        sys.exit("usage: a2v_lora.py LORA STRENGTH [LORA STRENGTH ...] -- <a2v arguments>")
    return [(pairs[i], float(pairs[i + 1])) for i in range(0, len(pairs), 2)]


def main():
    if "--" not in sys.argv:
        sys.exit("usage: a2v_lora.py LORA STRENGTH [LORA STRENGTH ...] -- <a2v arguments>")
    split = sys.argv.index("--")
    loras = _parse(sys.argv[1:split])
    rest = sys.argv[split + 1:]
    _patch(a2vid_distilled.A2VidDistilledPipeline, loras)
    _patch(a2vid_two_stage.A2VidPipelineTwoStage, loras)
    sys.argv = ["ltx-2-mlx", "a2v", *rest]
    cli.main()


if __name__ == "__main__":
    main()
