# Makefile for XYZ Setup

.PHONY: setup install-ollama start-ollama pull-model dev test-ollama ollama-test

# Detect OS!
OS := $(shell uname -s)

setup: install-ollama pull-model
	@echo "Setup complete! Run 'make dev' to start the app."

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

dev:
	@echo "Starting Vite development server..."
	@npm run dev
