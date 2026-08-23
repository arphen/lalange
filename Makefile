# Makefile for XYZ Setup

.PHONY: setup install-deps install-ollama start-ollama pull-model dev stop build run test-ollama ollama-test

# Detect OS!
OS := $(shell uname -s)

setup: install-ollama pull-model
	@echo "Setup complete! Run 'make dev' for local HTTP development or 'make run' for a production preview."

install-deps:
	@if [ ! -x node_modules/.bin/vite ]; then \
		echo "Installing npm dependencies..."; \
		if [ -f package-lock.json ]; then NODE_OPTIONS="--max-old-space-size=4096 $$NODE_OPTIONS" npm ci; else NODE_OPTIONS="--max-old-space-size=4096 $$NODE_OPTIONS" npm install; fi; \
	fi

install-ollama:
	@echo "Checking for Ollama..."
	@if ! command -v ollama >/dev/null 2>&1; then \
		echo "Ollama not found. Installing..."; \
		if [ "$(OS)" = "Darwin" ]; then \
			if command -v brew >/dev/null 2>&1; then \
				brew install ollama; \
			else \
				curl -fsSL https://ollama.com/install.sh | sh; \
			fi \
		else \
			curl -fsSL https://ollama.com/install.sh | sh; \
		fi \
	else \
		echo "Ollama is already installed."; \
	fi

start-ollama:
	@echo "Starting Ollama with CORS enabled..."
	@# Kill existing ollama instance if running to restart with env vars
	@pkill ollama || true
	@OLLAMA_ORIGINS="*" ollama serve > /dev/null 2>&1 & \
	echo "Waiting for Ollama to start..." && \
	sleep 5

pull-model: start-ollama
	@echo "Pulling llama3.1 model..."
	@ollama pull llama3.1

test-ollama: start-ollama
	@echo "Waiting for Ollama to become healthy..."
	@i=0; \
	until curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; do \
		i=$$((i+1)); \
		if [ $$i -ge 60 ]; then \
			echo "Ollama did not become ready at http://localhost:11434 within 60s"; \
			exit 1; \
		fi; \
		sleep 1; \
	done
	@echo "Running integration tests with Ollama..."
	@npm run test:ollama

# Backwards-compatible alias
ollama-test: test-ollama

dev: install-deps
	@echo "Starting local Vite development server (HTTP)..."
	@VITE_HTTPS=0 npm run dev

stop:
	@pids="$$(pgrep -f "$(CURDIR)/node_modules/.bin/vite" || true)"; \
	if [ -z "$$pids" ]; then \
		echo "No Vite server running for this checkout."; \
	else \
		echo "Stopping Vite server(s): $$pids"; \
		kill $$pids 2>/dev/null || true; \
	fi

build: install-deps
	@echo "Building production bundle..."
	@npm run build

run: build
	@echo "Starting production preview server over HTTPS..."
	@VITE_HTTPS=1 npm run preview -- --host

# =====================================================================
# Exhibition Render Pipeline (see docs/exhibition.md)
# =====================================================================
# Source epubs live in ./books (not ~/downloads). Override with BOOKS_DIR=...
BOOKS_DIR        = books
EXHIBITION_TEXTS = public/exhibition-texts
RAW_RENDERS      = renders/raw
FINAL_RENDERS    = renders/final
RAW_RENDERS_OFFSET30   = renders/raw_offset30
FINAL_RENDERS_OFFSET30 = renders/final_offset30
RENDER_DURATION  = 600
RENDER_RETRIES   = 2
RENDER_WPM       = 450
RENDER_WPM_OFFSET30 = 550
RENDER_START_OFFSET30 = 0.30

.PHONY: setup-exhibition parse-books render-test render-full render-full-offset30 clean-renders clean-renders-offset30

setup-exhibition:
	git checkout -b feature/exhibition-render || git checkout feature/exhibition-render
	npm install puppeteer --save-dev
	mkdir -p $(RAW_RENDERS) $(FINAL_RENDERS) $(EXHIBITION_TEXTS)

parse-books:
	node scripts/parse_books.js --source=$(BOOKS_DIR)

# Renders 6 books for 30 seconds, stitches them into one 3840x2160 grid.
render-test: parse-books
	node scripts/render_books.js --batch=test --duration=30
	bash scripts/stitch_grid.sh --batch=test

# Renders 3 batches of 6 books for 10 minutes each, stitches grids, concatenates.
render-full: parse-books
	node scripts/render_books.js --batch=1 --duration=$(RENDER_DURATION) --wpm=$(RENDER_WPM) --retries=$(RENDER_RETRIES)
	bash scripts/stitch_grid.sh --batch=1
	node scripts/render_books.js --batch=2 --duration=$(RENDER_DURATION) --wpm=$(RENDER_WPM) --retries=$(RENDER_RETRIES)
	bash scripts/stitch_grid.sh --batch=2
	node scripts/render_books.js --batch=3 --duration=$(RENDER_DURATION) --wpm=$(RENDER_WPM) --retries=$(RENDER_RETRIES)
	bash scripts/stitch_grid.sh --batch=3
	bash scripts/concatenate.sh

# Second 30-minute set from the same books, starting around 30% into each text,
# and running at 550 WPM.
render-full-offset30: parse-books
	mkdir -p $(RAW_RENDERS_OFFSET30) $(FINAL_RENDERS_OFFSET30)
	node scripts/render_books.js --batch=1 --duration=$(RENDER_DURATION) --wpm=$(RENDER_WPM_OFFSET30) --retries=$(RENDER_RETRIES) --start=$(RENDER_START_OFFSET30) --out=$(RAW_RENDERS_OFFSET30)
	RAW_DIR=$(RAW_RENDERS_OFFSET30) FINAL_DIR=$(FINAL_RENDERS_OFFSET30) bash scripts/stitch_grid.sh --batch=1
	node scripts/render_books.js --batch=2 --duration=$(RENDER_DURATION) --wpm=$(RENDER_WPM_OFFSET30) --retries=$(RENDER_RETRIES) --start=$(RENDER_START_OFFSET30) --out=$(RAW_RENDERS_OFFSET30)
	RAW_DIR=$(RAW_RENDERS_OFFSET30) FINAL_DIR=$(FINAL_RENDERS_OFFSET30) bash scripts/stitch_grid.sh --batch=2
	node scripts/render_books.js --batch=3 --duration=$(RENDER_DURATION) --wpm=$(RENDER_WPM_OFFSET30) --retries=$(RENDER_RETRIES) --start=$(RENDER_START_OFFSET30) --out=$(RAW_RENDERS_OFFSET30)
	RAW_DIR=$(RAW_RENDERS_OFFSET30) FINAL_DIR=$(FINAL_RENDERS_OFFSET30) bash scripts/stitch_grid.sh --batch=3
	FINAL_DIR=$(FINAL_RENDERS_OFFSET30) bash scripts/concatenate.sh --out=$(FINAL_RENDERS_OFFSET30)/exhibition_final_offset30.mp4

clean-renders:
	rm -rf $(RAW_RENDERS)/* $(FINAL_RENDERS)/*

clean-renders-offset30:
	rm -rf $(RAW_RENDERS_OFFSET30)/* $(FINAL_RENDERS_OFFSET30)/*
