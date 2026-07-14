# war-room v3 asset pipeline — Blender iso props -> spritesheet + manifest
#
#   make all            render everything + pack + stage (reproducible)
#   make render         headless Blender render (16 props x 4 rotations)
#   make pack           trim/downscale/pack -> ../../webview-v3-assets/
#   make render-chars   headless character render (18 sprites, 140 frames)
#   make pack-chars     pack characters -> characters.*.sheet.png
#   make preview PROP=desk_monitor           fast single-prop loop
#   make preview-chars SPRITE=worker_teal.walk   fast single-sprite loop
#   make repack-stage    losslessly apply current grouping to staged atlases
#   make validate        schema-validate every staged manifest (npm run validate)
#   make screenshots      DPR-1 + DPR-3 viewer.html captures -> .planning/v3/screenshots/assets/
#   make qa               validate + screenshots
#   make clean          drop the out/ working dir

BLENDER ?= /Applications/Blender.app/Contents/MacOS/Blender
PY      ?= python3
NPM     ?= npm
OUT     := out
STAGE   := ../../webview-v3-assets
SAMPLES ?= 96

.PHONY: all render pack render-chars pack-chars repack-stage preview preview-chars validate screenshots qa clean

all: render pack render-chars pack-chars

render:
	$(BLENDER) -b -P blender/render_props.py -- --out $(OUT)/raw --samples $(SAMPLES)

pack:
	$(PY) pack.py --raw $(OUT)/raw --stage $(STAGE) --name props

render-chars:
	$(BLENDER) -b -P blender/render_characters.py -- --out $(OUT)/raw-chars --samples $(SAMPLES)

pack-chars:
	$(PY) pack.py --raw $(OUT)/raw-chars --stage $(STAGE) --name characters

repack-stage:
	$(PY) repack_stage.py --stage $(STAGE) --name props
	$(PY) repack_stage.py --stage $(STAGE) --name characters

preview:
	@test -n "$(PROP)" || (echo "usage: make preview PROP=<name>"; exit 1)
	$(BLENDER) -b -P blender/render_props.py -- --out $(OUT)/preview --props $(PROP) --samples 48

preview-chars:
	@test -n "$(SPRITE)" || (echo "usage: make preview-chars SPRITE=<name>"; exit 1)
	$(BLENDER) -b -P blender/render_characters.py -- --out $(OUT)/preview-chars --sprites $(SPRITE) --samples 48

validate:
	$(NPM) run validate

screenshots:
	$(NPM) run screenshot

qa: validate screenshots

clean:
	rm -rf $(OUT)
