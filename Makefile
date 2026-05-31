# Makefile for XYZ Setup

.PHONY: setup install-deps install-ollama start-ollama pull-model dev build run test-ollama ollama-test

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

build: install-deps
	@echo "Building production bundle..."
	@npm run build

run: build
	@echo "Starting production preview server..."
	@npm run preview -- --host
