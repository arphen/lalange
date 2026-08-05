# XYZ - Free AI Speed Reading App

**Private, local-first RSVP reading with optional semantic pacing from 50 to 2,000 WPM.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

XYZ is a free, open-source speed reading application that runs entirely in your browser. No servers, no logins, no tracking—just you and your books.

## ✨ Features

- **🚀 RSVP Technology** - Rapid Serial Visual Presentation displays words at a fixed point, eliminating eye movement
- **🧠 AI-Powered Pacing** - Local LLM analyzes text complexity and adjusts speed automatically
- **🔒 100% Private** - Everything runs in your browser. Your books never leave your device
- **📚 Multi-Format Support** - Upload EPUB, PDF, Markdown, or TXT files from your library
- **⚡ 50-2000 WPM** - Adjustable reading speed to match your comfort level
- **📱 Works Offline** - Once loaded, works without internet connection
- **🔄 P2P Sync** - Sync between devices via QR code (no cloud needed)

## 🎯 Why XYZ?

Traditional speed reading apps force you to process simple words like "hello" at the same speed as complex philosophical concepts. Your brain doesn't work that way.

XYZ uses a local AI model (running entirely in your browser via WebLLM) to analyze text density and automatically adjust pacing:
- **Simple passages** → Speed up
- **Complex ideas** → Slow down

This creates a natural reading rhythm that matches how your brain actually processes information.

## 🚀 Quick Start

1. Visit [xyz.com](https://xyz.com)
2. Upload a supported file: EPUB, PDF, Markdown, or TXT (or try the demo)
3. Start reading!

No installation, no account, no setup.

## 💻 Development

```bash
# Clone the repo
git clone https://github.com/arpheno/lalange.git
cd lalange

# Install dependencies
npm install

# Start dev server
npm run dev

# Optional: add TURN for networks that cannot establish a direct WebRTC path
VITE_WEBRTC_ICE_SERVERS='[{"urls":"turns:relay.example.com:5349","username":"app-user","credential":"app-password"}]' npm run dev

# Run tests
npm test -- --run

# Download a small deterministic Gutenberg EPUB corpus and run structure/TOC checks
npm run gutenberg:corpus -- --count=6 --seed=xyz-epub-corpus --clean

# Build for production
npm run build
```

## 🏗️ Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS
- **AI**: WebLLM (local LLM inference via WebGPU)
- **Storage**: RxDB + IndexedDB (local-first)
- **Sync**: WebRTC (peer-to-peer through STUN, with optional TURN relay)

## 📖 Documentation

- [Field Manual](https://xyz.com/manual) - How to use XYZ effectively
- [Research](https://xyz.com/research) - The theory behind neuro-semantic pacing
- [Manifesto](https://xyz.com/manifesto) - Our philosophy on local-first AI

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [WebLLM](https://github.com/mlc-ai/web-llm) for enabling local LLM inference (embedded under Apache License 2.0)
- [Project Gutenberg](https://www.gutenberg.org/) for free public domain books
- The open source community

---

**Made with ❤️ by [Arphen](https://github.com/arpheno)**

*No logins. No tracking. Just reading.*
