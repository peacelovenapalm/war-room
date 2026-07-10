# war-room v3 asset pipeline — Blender iso props -> spritesheet + manifest
#
#   make all            render everything + pack + stage (reproducible)
#   make render         headless Blender render (16 props x 4 rotations)
#   make pack           trim/downscale/pack -> ../../webview-v3-assets/
#   make preview PROP=desk_monitor   fast single-prop iteration loop
#   make clean          drop the out/ working dir

BLENDER ?= /Applications/Blender.app/Contents/MacOS/Blender
PY      ?= python3
OUT     := out
STAGE   := ../../webview-v3-assets
SAMPLES ?= 96

.PHONY: all render pack preview clean

all: render pack

render:
	$(BLENDER) -b -P blender/render_props.py -- --out $(OUT)/raw --samples $(SAMPLES)

pack:
	$(PY) pack.py --raw $(OUT)/raw --stage $(STAGE) --name props

preview:
	@test -n "$(PROP)" || (echo "usage: make preview PROP=<name>"; exit 1)
	$(BLENDER) -b -P blender/render_props.py -- --out $(OUT)/preview --props $(PROP) --samples 48

clean:
	rm -rf $(OUT)
