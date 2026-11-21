"""`ltx-2-mlx a2v` with a LoRA fused into the transformer (Komfy).

The a2v subcommand of ltx-2-mlx 0.18 has no `--lora` flag, but its
pipelines fuse whatever sits in `self._pending_loras` when they load the
transformer (the mechanism `generate` and `ic-lora` use). This wrapper sets
that list right after the pipeline is built, then hands the remaining
arguments to the regular CLI. The run log shows "Fusing LoRA" when it took.

Run with the ltx-2-mlx virtualenv's python:
  python a2v_lora.py LORA STRENGTH -- <a2v arguments>
"""

import sys

from ltx_pipelines_mlx import a2vid_distilled, a2vid_two_stage, cli


def _patch(cls, lora, strength):
    original = cls.__init__

    def init(self, *args, **kwargs):
        original(self, *args, **kwargs)
        self._pending_loras = [(lora, strength)]
        print(f"Pending LoRA: {lora} ({strength})", flush=True)

    cls.__init__ = init


def main():
    if len(sys.argv) < 4 or "--" not in sys.argv:
        sys.exit("usage: a2v_lora.py LORA STRENGTH -- <a2v arguments>")
    lora, strength = sys.argv[1], float(sys.argv[2])
    rest = sys.argv[sys.argv.index("--") + 1:]
    _patch(a2vid_distilled.A2VidDistilledPipeline, lora, strength)
    _patch(a2vid_two_stage.A2VidPipelineTwoStage, lora, strength)
    sys.argv = ["ltx-2-mlx", "a2v", *rest]
    cli.main()


if __name__ == "__main__":
    main()
