# Integration Guide: WebLLM with Input Logprobs for RSVP

This guide details how to integrate the custom TinyLlama model and modified WebLLM library into your RSVP (Rapid Serial Visual Presentation) application to access input token log probabilities.

## 1. Prerequisites (Assets)

These assets can be found in the source repositories for this project.

**Source Repositories:**
*   **Main Project / Models**: [https://github.com/arpheno/logitwebllm](https://github.com/arpheno/logitwebllm)
*   **WebLLM Source Fork**: [https://github.com/arpheno/web-llm](https://github.com/arpheno/web-llm)

You need to move two key assets from the `logitwebllm` workspace to your target project:

1.  **The Custom WASM Runtime**: `TinyLlama-1.1B-minimal.wasm`
    *   *Repo Location*: `logitwebllm/models/TinyLlama-1.1B-Chat-v1.0-q4f16_1/TinyLlama-1.1B-minimal.wasm`
    *   *Purpose*: Contains the compiled model code with the special `prefill_all_logits` function needed to extract logprobs efficiently.
2.  **The Modified WebLLM Library**:
    *   *Repo Location*: `logitwebllm/web-llm` (specifically the build output in `lib/`)
    *   *Purpose*: The TypeScript client that exposes the `return_input_logprobs` API option.

---

## 2. Installation Steps

### Step A: Install the Modified WebLLM Library

Since this feature relies on a custom fork, you cannot use the standard `@mlc-ai/web-llm` from npm.

**Option 1: File Dependency (Recommended)**
In your RSVP project's `package.json`, point to the local folder:

```json
{
  "dependencies": {
    "@mlc-ai/web-llm": "file:../path/to/logitwebllm/web-llm"
  }
}
```
Run `npm install`.

**Option 2: Copy Library Files**
If you prefer not to link folders, build the library in the source project:
1.  Run `npm run build` inside `logitwebllm/web-llm`.
2.  Copy the `logitwebllm/web-llm/lib` folder into your RSVP project (e.g., to `src/vendor/web-llm`).
3.  Update your imports: `import * as webllm from "./vendor/web-llm";`

### Step B: Deploy the Custom WASM

1.  Copy `TinyLlama-1.1B-minimal.wasm` to your application's public static assets folder (e.g., `/public` for Vite/Next.js/React).
2.  (Optional) Rename it to `TinyLlama-1.1B.wasm` for simplicity.

**Verify**: You should be able to access `http://localhost:YOUR_PORT/TinyLlama-1.1B.wasm` in your browser.

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
