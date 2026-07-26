# ⚡ Tanzeel (تنزیل) - Premium Video Downloader & Engine

[![Build & Deploy Status](https://github.com/USERNAME/REPOSITORY/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/USERNAME/REPOSITORY/actions)
[![Node.js Version](https://img.shields.io/badge/Node.js-v20.x-green.svg)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Security Audited](https://img.shields.io/badge/Security-Audited-emerald.svg)](#security--architecture)

**Tanzeel (تنزیل)** is a high-performance, responsive web application and server engine designed for downloading videos across multiple platforms. Built with Node.js, Express, `yt-dlp`, and modern vanilla Web APIs, it provides live stream conversion, metadata analysis, real-time download progress tracking, and mobile-first glassmorphism design.

---

## 🌟 Key Features

- **⚡ Fast Metadata Analysis**: Parses video metadata, resolution options, and platform details instantly.
- **🎥 Multi-Platform Support**: Powered by `yt-dlp` engine, supporting YouTube, Shorts, Twitter/X, Instagram, and hundreds of media platforms.
- **📊 Real-Time Progress Tracking**: Live percentage status, download speed, ETA, and size calculations.
- **🛡️ Enterprise Security**: Isolated static directory serving (`public/`), credential protection, and automatic process lifecycle cleanup on request termination.
- **📱 Responsive Glassmorphism UI**: Beautiful, dark-mode, mobile-optimized experience with micro-animations.
- **🔄 Automated CI/CD**: Built-in GitHub Actions pipeline for testing and instant live auto-deployment on git push.
- **🐳 Docker Ready**: Containerized with lightweight Alpine Linux base for zero-configuration cloud deployment.

---

## 🏗️ Architecture Overview

```
                          ┌────────────────────────┐
                          │    Browser Client      │
                          │   (Glassmorphism UI)   │
                          └───────────┬────────────┘
                                      │
                         REST API     │  HTTP Stream
                         /analyze     │  /download
                                      ▼
                          ┌────────────────────────┐
                          │   Node.js / Express    │
                          │     Server Engine      │
                          └───────────┬────────────┘
                                      │
                         Child Process│  STDIN / STDOUT
                         (exec/spawn) │  Piping
                                      ▼
                          ┌────────────────────────┐
                          │    yt-dlp + ffmpeg     │
                          │     Binary Engine      │
                          └────────────────────────┘
```

---

## 🚀 Live Auto-Deployment (GitHub Integration)

Tanzeel comes pre-configured with **GitHub Actions** for Continuous Integration (CI) and Continuous Deployment (CD). Pushing code to GitHub will automatically trigger test verification and update your live app!

### Setup Auto-Deploy in 3 Steps:

#### Option A: Render.com (Free & Recommended)
1. Push your project to GitHub.
2. Sign in to [Render.com](https://render.com) and click **New > Blueprint**.
3. Connect your GitHub repository. Render will read [`render.yaml`](file:///c:/Users/iAT/Downloads/Rawafid%20app/render.yaml) and automatically build & deploy your live app on every `git push`!

#### Option B: GitHub Actions Webhook Auto-Deploy
1. Go to your GitHub Repository > **Settings** > **Secrets and variables** > **Actions**.
2. Add a repository secret named `RENDER_DEPLOY_HOOK_URL` containing your deployment webhook URL.
3. Every time you run `git push origin main`, GitHub Actions will run tests and automatically trigger your live server update!

---

## 💻 Local Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Git](https://git-scm.com/)

### Step 1: Clone Repository
```bash
git clone https://github.com/YOUR_USERNAME/rawafid-app.git
cd rawafid-app
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Start Application
- **Development Mode** (with auto-reload):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm start
  ```

Open your browser at `http://localhost:3000`.

---

## 🧪 Testing Suite

Run the automated integration test suite powered by **Jest** and **Supertest**:

```bash
npm test
```

Test coverage includes:
- Security boundary verification (`cookies.txt` isolation)
- Endpoint contract validation (`/analyze`, `/download`, `/progress`)

---

## 🔒 Security & Best Practices

- **Static Asset Isolation**: All front-end assets are located inside `public/`. Private configuration files (`cookies.txt`, `server.js`, `package.json`) are protected from HTTP access.
- **Process Memory Safety**: Sub-processes spawned for downloads listen to client disconnect events (`req.on('close')`) and terminate automatically to prevent server resource leaks.

---

## 📄 Repository Structure

```
├── .github/
│   └── workflows/
│       └── ci-cd.yml      # GitHub Actions CI/CD Pipeline
├── public/                # Isolated Static Web Assets
│   ├── index.html         # Application Markup
│   ├── app.js             # Client Script & UI Controller
│   └── style.css          # Glassmorphism Design System
├── tests/
│   └── server.test.js     # API & Security Integration Tests
├── Dockerfile             # Alpine Docker Build Specification
├── render.yaml            # Render Blueprint Configuration
├── server.js              # Express API Server & Binary Spawner
├── package.json           # Dependencies & Scripts
└── README.md              # Project Documentation
</div>
```

---

## 👨‍💻 Credits & License

- **Project Lead**: Al-Ulama & Sudoor.org
- **License**: [ISC](LICENSE)
