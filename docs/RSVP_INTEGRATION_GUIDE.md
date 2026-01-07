# Integration Guide: WebLLM with Input Logprobs for RSVP

This guide details how to integrate the custom TinyLlama model and modified WebLLM library into your RSVP (Rapid Serial Visual Presentation) application.

## 🚀 One-Step Automated Install

I have created an automated script that handles the dependency installation and asset downloading for you.

Run this command in the root of your RSVP application:

```bash
curl -sL https://raw.githubusercontent.com/arpheno/logitwebllm/main/scripts/install_logit_support.sh | bash
```

This script will:
1.  **Install the library**: Adds `github:arpheno/web-llm` to your `package.json`.
2.  **Download the Runtime**: Fetches `TinyLlama-1.1B.wasm` and places it in your `public/` folder.

---

## Manual Steps (If Automated Install Fails)

### Step A: Install the Modified WebLLM Library

Since I have committed the build artifacts to the repository, you can install directly from GitHub:

```bash
npm install github:arpheno/web-llm
```

### Step B: Download the Custom WASM

Download the custom runtime manually and place it in your `public/` folder:

*   **TinyLlama**: [TinyLlama-1.1B-minimal.wasm](https://github.com/arpheno/logitwebllm/raw/main/models/TinyLlama-1.1B-Chat-v1.0-q4f16_1/TinyLlama-1.1B-minimal.wasm) -> `public/TinyLlama-1.1B.wasm`
*   **Qwen 2.5** (Optional): [Qwen2.5-1.5B.wasm](https://github.com/arpheno/logitwebllm/raw/main/models/Qwen2.5-1.5B-q4f16_1/Qwen2.5-1.5B.wasm) -> `public/Qwen2.5-1.5B.wasm`

---

## 3. Implementation

### Initialize the Engine

Configure the engine to use standard weights from HuggingFace but force it to use your **local custom WASM**.

```typescript
import * as webllm from "@mlc-ai/web-llm";

// Define configuration
const appConfig = {
  model_list: [
    {
      // 1. Standard Model Weights (downloaded from CDN)
      model: "https://huggingface.co/mlc-ai/TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
      model_id: "TinyLlama-1.1B-logprobs",
      
      // 2. YOUR Custom WASM (served locally)
      // This path must be relative to your web server root
      model_lib: "/TinyLlama-1.1B.wasm", 
      
      // 3. Resource settings
      vram_required_MB: 700,
      low_resource_required: true,
    },
    {
      // ALTERNATIVE: Qwen 2.5
      model: "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
      model_id: "Qwen2.5-1.5B-logprobs",
      model_lib: "/Qwen2.5-1.5B.wasm", // Requires custom Qwen WASM
      vram_required_MB: 1200,
      low_resource_required: true, 
    }
  ],
};

// Create the engine
// Note: This might take a moment to load weights on first run
const engine = await webllm.CreateMLCEngine("TinyLlama-1.1B-logprobs", {
  appConfig: appConfig,
  initProgressCallback: (report) => console.log(report.text), // Optional loading progress
});
```

### Fetch Logprobs for RSVP

Here is how to get the data you need for RSVP (tokens + their probabilities).

```typescript
async function getRSVPData(text) {
  const response = await engine.chat.completions.create({
    messages: [{ role: "user", content: text }],
    max_tokens: 1, // We only care about the input analysis, stop immediately after
    return_input_logprobs: true, // <--- THE ENABLE FLAGS
  });

  const tokens = response.input_tokens;     // string[]: e.g. ["The", " quick", " brown"]
  const logprobs = response.input_logprobs; // number[]: e.g. [-0.1, -5.2, -1.2]

  // Combine for RSVP
  // Higher negative logprob (e.g. -10) = lower probability = more surprising word
  // You might want to display surprising words for longer durations
  return tokens.map((token, index) => ({
    word: token,
    logprob: logprobs[index],
    probability: Math.exp(logprobs[index])
  }));
}

// Example usage
const data = await getRSVPData("The quick brown fox jumps over the lazy dog.");
console.log(data);
```

## 4. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `input_logprobs` is `undefined` | Using standard npm library | Ensure `package.json` points to local modified web-llm folder. |
| `input_logprobs` is `undefined` | Using standard WASM | Ensure `model_lib` in config points to your usage of `minimal.wasm`. |
| `LinkError` / WASM validation error | Mismatched Runtime | Ensure you are using the `minimal` WASM build compatible with the browser environment. |
| 404 on `.wasm` file | Path error | Check that the WASM file is in your public directory and `model_lib` starts with `/`. |
