# <img src="icon-512.png" alt="Notez Logo" width="100" height="100" /> Notez



[![Firebase Hosting](https://img.shields.io/badge/Firebase-Hosting-ffca28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/products/hosting)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-f7df1e?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Python-3.12-3776ab?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Ai--Notez.web.app-00c853?style=for-the-badge&logo=google-chrome&logoColor=white)](https://ai-notez.web.app/)

---

## ✨ **What is Notez?**

**Notez** is a **study-focused, distraction-free note-taking application** designed to help students and knowledge workers organize their learning materials in one unified workspace. Built as a **browser-based PWA (Progressive Web App)**, Notez combines the simplicity of local note-taking with the power of **cloud sync, AI assistance, and semantic search**.

Whether you're managing lecture notes, PDF documents, transcripts, or research materials, Notez provides a **calm, focused environment** where you can:
- ✍️ Create, edit, and organize notes with rich formatting
- 📁 Manage notes in folders and collections
- 🔍 Search and browse your knowledge base instantly
- 📚 Read and annotate PDFs directly in the app
- 🎙️ Record lectures with **real-time transcription** (Gemini 2.5 Flash)
- 🤖 Leverage AI for summaries, study guidance, and smart insights
- 👤 **Voice profiles** for speaker identification and accuracy
- 📝 **Live notes generation** alongside transcription
- 🔄 Sync seamlessly across devices with Firebase
- 📱 Work offline with service worker support

---

## 🎯 **The Problem We Solve**

Students and professionals often struggle with **fragmented knowledge** — notes scattered across:
- Multiple apps (Notion, OneNote, Google Docs)
- Local files and folders
- Browser tabs and bookmarks
- Physical notebooks and digital scans

This fragmentation **breaks focus** and makes **effective review difficult**. Notez solves this by providing:

| Problem | Notez Solution |
|---------|---------------|
| 📂 Notes scattered everywhere | ✅ Unified workspace for all your materials |
| 🔍 Hard to find information | ✅ Instant search across all notes and PDFs |
| 📱 No offline access | ✅ Full offline support with cloud sync |
| 🤖 Limited AI assistance | ✅ Built-in AI for summaries, insights, and study guidance |
| 📚 PDFs hard to manage | ✅ Native PDF reader with annotation support |
| 🎙️ Audio notes disconnected | ✅ **Real-time transcription** with speaker identification |
| 👤 No voice recognition | ✅ **Voice profiles** for accurate speaker labeling |
| 📝 Manual note-taking | ✅ **Live AI notes** generated automatically |

---

## 🚀 **Live Demo**

**Try Notez now:** [https://ai-notez.web.app/](https://ai-notez.web.app/)

> ⚠️ **Note:** The demo uses Firebase Authentication. Sign in with Google or email to experience the full functionality.

---

## 📸 **Screenshots**

> 📌 **Coming Soon!** 
> We're working on adding beautiful screenshots to showcase Notez's interface and features. In the meantime, try the [live demo](https://ai-notez.web.app/) to see it in action!

---

## ✨ **Key Features**

### 📝 **Note Management**
- **Rich Text Editing**: Format notes with markdown-like syntax
- **Folder Organization**: Create nested folders for better organization
- **Tagging & Categorization**: Add tags and priorities to notes
- **Favorites & Pinning**: Quick access to important notes
- **Search & Filter**: Find notes by title, content, or tags
- **Version History**: Track changes to your notes

### 📚 **Document Handling**
- **PDF Reader**: View and annotate PDFs directly in the app
- **Document Attachments**: Attach files to notes
- **Library View**: Organize all your documents in one place
- **Full-Text Search**: Search within PDFs and documents

### 🤖 **AI-Powered Features**
- **Smart Summaries**: Get AI-generated summaries of your notes
- **Study Guidance**: AI-powered study recommendations
- **Semantic Search**: Find notes based on meaning, not just keywords
- **Real-Time Transcription**: Live speech-to-text with <2s latency using **Gemini 2.5 Flash**
- **Voice Profiles**: Speaker identification with custom profiles
- **Live AI Notes**: Automatic note generation alongside transcription
- **Owner Voice Tagging**: Automatic labeling of your voice as `[Owner]`
- **Context-Aware Transcription**: Improved accuracy with subject context
- **Note Insights**: AI analysis of your study patterns

### ☁️ **Cloud & Sync**
- **Firebase Authentication**: Secure sign-in with Google, email, etc.
- **Realtime Database**: Instant sync across all devices
- **Offline First**: Full functionality without internet
- **Automatic Sync**: Changes sync when you're back online

### 🎨 **User Experience**
- **Dark/Light Mode**: Choose your preferred theme
- **Custom Accents**: Personalize with color themes
- **PIN Lock**: Protect your notes with a PIN
- **PWA Support**: Install as a desktop/mobile app
- **Keyboard Shortcuts**: Speed up your workflow

### 🎤 **Voice & Transcription Features**
- **Real-Time Recording**: Live audio capture with immediate transcription
- **Voice Profiles**: Create and manage speaker profiles for accurate identification
- **Owner Voice Setup**: Configure your voice for automatic `[Owner]` tagging
- **Speaker Diarization**: Automatic Voice 1, Voice 2 labeling
- **Live Notes Generation**: AI creates structured notes alongside transcription
- **Context Integration**: Subject-aware transcription for improved accuracy
- **Voice Calibration**: Record samples to improve recognition accuracy
- **Recording Controls**: Start, pause, resume, stop with one-click
- **Transcript History**: Full transcript saved as markdown note

---

## 🛠️ **Technology Stack**

### **Frontend**
| Technology | Purpose | Version |
|------------|---------|---------|
| ![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white) | Structure | HTML5 |
| ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white) | Styling | CSS3 |
| ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black) | Logic | ES6+ |
| ![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black) | Hosting & Auth | v10.12.5 |
| ![Service Worker](https://img.shields.io/badge/Service_Worker-4285F4?style=flat-square&logo=google-chrome&logoColor=white) | Offline Support | Native |

### **Backend (Optional)**
| Technology | Purpose | Version |
|------------|---------|---------|
| ![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white) | Server Logic | 3.12+ |
| ![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat-square&logo=fastapi&logoColor=white) | API Framework | Latest |
| ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white) | Local Database | Native |
| ![USearch](https://img.shields.io/badge/USearch-7B2CBF?style=flat-square) | Vector Search | HNSW |
| ![Firebase Admin](https://img.shields.io/badge/Firebase_Admin-FFCA28?style=flat-square&logo=firebase&logoColor=black) | Auth Verification | Latest |

### **AI Providers**
| Provider | Purpose |
|----------|---------|
| ![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=flat-square&logo=google&logoColor=white) | AI Chat & Embeddings |
| ![Groq](https://img.shields.io/badge/Groq-00D4AA?style=flat-square) | Fast AI Inference |

---

## 📁 **Project Structure**

```
Ai-Notez/
├── index.html                    # Main app entry point
├── manifest.webmanifest          # PWA manifest
├── sw.js                        # Service worker for offline
├── firebase.json                # Firebase hosting config
├── database.rules.json          # Firebase database rules
├── README.md                    # This file
├── icon-192.png                 # App icon (192x192)
├── icon-512.png                 # App icon (512x512)
├── styles/
│   └── app.css                  # Main stylesheet
├── app/
│   ├── 01-config-and-core.js    # Firebase config & core state
│   ├── 02-storage-and-notes.js  # Note storage & rendering
│   ├── 03-library-and-folders.js # Library & PDF management
│   ├── 04-reader-and-html.js    # Reading & export features
│   ├── 05-sync-and-auth.js      # Authentication & AI features
│   └── 06-ai-and-recording.js   # AI flows & voice features
└── backend/
    ├── main.py                  # FastAPI backend
    ├── requirements.txt         # Python dependencies
    ├── .env.example             # Environment template
    └── tests/                   # Backend tests
```

---

## 💻 **Local Development**

### **Prerequisites**
- Node.js (optional, for Firebase CLI)
- Python 3.12+ (for backend)
- Git
- A modern web browser

### **Frontend Setup**

Notez is a **static web app** with no build step required!

#### **Option 1: Simple Python Server (Recommended)**
```bash
# Clone the repository
git clone https://github.com/ShanMade/Ai-Notez.git
cd Ai-Notez

# Start a local server
python -m http.server 8000

# Open in browser
# http://localhost:8000
```

#### **Option 2: Firebase Emulator**
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Start emulators
firebase emulators:start

# Open in browser
# http://localhost:5000
```

#### **Option 3: Live Server (VS Code)**
1. Open the project in VS Code
2. Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension
3. Right-click on `index.html` and select "Open with Live Server"

---

## 🚀 **Deployment**

### **Deploy to Firebase Hosting**

#### **Step 1: Set up Firebase Project**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (e.g., `your-notez-app`)
3. Enable **Authentication** and **Realtime Database**
4. Note your project settings

#### **Step 2: Update Configuration**
Edit `app/01-config-and-core.js` and update the `firebaseConfig`:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

#### **Step 3: Deploy**
```bash
# Install Firebase CLI (if not already installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase (if first time)
firebase init hosting

# Deploy to production
firebase deploy
```

Your app will be live at: `https://YOUR_PROJECT.web.app`

### **Deploy Backend (Optional)**

The FastAPI backend can be deployed to:
- [FastAPI Cloud](https://fastapicloud.dev/) (Recommended)
- [Render](https://render.com/)
- [Railway](https://railway.app/)
- [Fly.io](https://fly.io/)
- Any VPS with Python support

#### **FastAPI Cloud Deployment**
```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy .env.example to .env and configure
cp .env.example .env

# Deploy to FastAPI Cloud
fastapi deploy
```

---

## 🔧 **Backend Configuration**

### **Environment Variables**

Create a `.env` file in the `backend/` directory:

```env
# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
GOOGLE_APPLICATION_CREDENTIALS=path/to/firebase-admin.json

# AI Provider Keys
AI_GEMINI_API_KEY=your-gemini-api-key
AI_GROQ_API_KEY=your-groq-api-key
AI_EMBEDDING_API_KEY=your-embedding-api-key

# CORS Origins (comma-separated)
NOTEZ_CORS_ORIGINS=https://your-frontend.web.app,http://localhost:8000

# Data Directory
NOTEZ_DATA_DIR=./data

# Embedding Dimensions
AI_EMBEDDING_DIMENSIONS=768
```

> ⚠️ **IMPORTANT**: Never commit your `.env` file or `firebase-admin.json` to version control!

### **Windows Setup**

For Windows users, use PowerShell:

```powershell
cd backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$venv = Join-Path $HOME '.venvs\notez-backend'
if (-not (Test-Path "$venv\Scripts\python.exe")) { py -3.12 -m venv $venv }
$python = "$venv\Scripts\python.exe"
& $python -m pip install --upgrade pip
& $python -m pip install -r requirements.txt
```

---

## 🤖 **AI Features Setup**

### **Option 1: Use Hosted Backend (Recommended)**
1. Deploy the backend to FastAPI Cloud or another service
2. Update the `notez-ai-api-base-url` meta tag in `index.html`:
   ```html
   <meta name="notez-ai-api-base-url" content="https://your-backend-url.dev" />
   ```
3. Configure AI provider keys in your backend's environment variables

### **Option 2: Local AI (BYOK - Bring Your Own Key)**
1. Leave the `notez-ai-api-base-url` meta tag empty or remove it
2. The app will prompt you to enter your AI provider API key
3. Supported providers: Gemini, Groq

### **Option 3: No AI**
- Simply don't configure any AI backend
- AI features will be disabled in the UI

---

## 🧪 **Testing**

### **Frontend Testing**
Run these smoke tests manually:

1. ✅ Load the app locally
2. ✅ Create a test note
3. ✅ Search for the note
4. ✅ Open and edit the note
5. ✅ Test folder creation and organization
6. ✅ Verify Firebase auth flow works
7. ✅ Confirm service worker doesn't break loading
8. ✅ Test dark/light mode toggle
9. ✅ Test PIN lock functionality

### **Backend Testing**

From the `backend/` directory:

```bash
# Install pytest
pip install pytest

# Run tests
pytest -q tests

# Or with virtual environment
& "$HOME\.venvs\notez-backend\Scripts\python.exe" -m pytest -q tests
```

---

## 📊 **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    Notez Frontend                          │ │
│  │  • index.html (App Shell)                                │ │
│  │  • app/01-config-and-core.js (Firebase Config)           │ │
│  │  • app/02-storage-and-notes.js (Note Management)         │ │
│  │  • app/03-library-and-folders.js (Library)               │ │
│  │  • app/04-reader-and-html.js (Reader)                    │ │
│  │  • app/05-sync-and-auth.js (Auth & AI)                   │ │
│  │  • app/06-ai-and-recording.js (AI & Voice)              │ │
│  │  • sw.js (Service Worker for Offline)                   │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Firebase Services                          │
│  ┌─────────────┐  ┌─────────────────────┐  ┌─────────────┐ │
│  │   Auth      │  │  Realtime Database   │  │   Hosting   │ │
│  │             │  │  (Notes, Metadata)    │  │             │ │
│  └─────────────┘  └─────────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Optional AI Backend                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                 FastAPI Backend                           │ │
│  │  • Authentication: Firebase ID Token Verification         │ │
│  │  • AI Services: Chat, Summaries, Insights                 │ │
│  │  • Vector Search: Semantic note search                   │ │
│  │  • Embeddings: Note chunking & vectorization             │ │
│  │  • Storage: SQLite (Metadata) + USearch (Vectors)         │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Providers                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Gemini     │  │    Groq      │  │  Custom Embeddings   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎨 **Customization**

### **Themes**
Notez supports multiple themes:
- **Light Mode** (default)
- **Dark Mode**
- **Custom Accent Colors**: yellow (gold), green (forest), blue (sky)

Toggle themes using the theme switcher in the app or by setting:
```javascript
localStorage.setItem('notez-theme-v1', 'dark');
localStorage.setItem('notez-accent-v1', 'forest');
```

### **PIN Lock**
Enable PIN protection:
```javascript
localStorage.setItem('notez-lock-v1', 'true');
localStorage.setItem('notez-lock-pin', 'your-pin');
```

---

## 📈 **Roadmap**

### **Upcoming Features**
- [ ] **Backend Streaming**: Real-time AI responses
- [ ] **Global Quotas**: User-based API rate limiting
- [ ] **Managed Speech Transcription**: Server-side audio processing
- [ ] **Durable Chat History**: Server-side chat persistence
- [ ] **Collaborative Notes**: Real-time collaboration
- [ ] **Mobile Apps**: Native iOS and Android apps
- [ ] **Desktop Apps**: Native macOS, Windows, Linux apps
- [ ] **Plugin System**: Extend Notez with plugins

### **Long-term Vision**
- **Universal Knowledge Base**: One place for all your learning
- **Smart Study Coach**: AI-powered study planning and tracking
- **Knowledge Graph**: Visualize connections between your notes
- **Multi-device Sync**: Seamless experience across all platforms

---

## 🤝 **Contributing**

We welcome contributions! Here's how you can help:

### **How to Contribute**
1. **Fork** the repository
2. **Clone** your fork locally
3. **Create** a new branch for your feature/bugfix
4. **Commit** your changes with clear messages
5. **Push** to your fork
6. **Open** a Pull Request to the main repository

### **Contribution Guidelines**
- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Keep commits atomic and focused
- Write clear, descriptive commit messages

### **Good First Issues**
- Add more keyboard shortcuts
- Improve mobile responsiveness
- Add additional export formats
- Write more backend tests
- Improve error handling
- Add tooltips and help text

---

## 🐛 **Known Limitations**

| Limitation | Workaround | Status |
|------------|------------|--------|
| AI backend is optional | Use BYOK or deploy backend | ⚠️ Temporary |
| Local HNSW index requires persistent disk | Don't share data directory | ⚠️ Temporary |
| No frontend test suite | Manual testing required | 📋 Planned |
| Chats are browser-local | Not migrated to server | 📋 Planned |
| Semantic indexing requires embedding credential | Configure AI provider | ⚠️ Required |
| Firebase config in client | Review before public use | ⚠️ Caution |

---

## 🔒 **Security**

### **Important Security Notes**
- ❌ **Never commit** `firebase-admin.json` or service account keys
- ❌ **Never commit** `.env` files with API keys
- ❌ **Never put** backend secrets in frontend code
- ✅ **Always** keep Firebase rules restrictive
- ✅ **Always** test authentication with real users
- ✅ **Always** rotate credentials if compromised

### **Firebase Rules**
Review and customize `database.rules.json` for your security needs:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    }
  }
}
```

---

## 📄 **License**

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024 ShanMade

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 **Acknowledgments**

- **Firebase**: For providing an excellent backend-as-a-service platform
- **FastAPI**: For making Python API development a joy
- **USearch**: For efficient vector search capabilities
- **All Contributors**: For their valuable input and improvements

---

## 📞 **Support & Contact**

### **Need Help?**
- **Documentation**: Check this README for setup and usage
- **Issues**: Open a [GitHub Issue](https://github.com/ShanMade/Ai-Notez/issues)
- **Discussions**: Join the [GitHub Discussions](https://github.com/ShanMade/Ai-Notez/discussions)
- **Email**: Contact the maintainer (if available)

### **Found a Bug?**
Please open an issue with:
- A clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Screenshots (if applicable)
- Browser and OS information

### **Have a Feature Request?**
We'd love to hear your ideas! Open a feature request issue with:
- Description of the feature
- Use case or problem it solves
- Any mockups or examples (if available)

---

## 🌟 **Stargazers & Contributors**

<a href="https://github.com/ShanMade/Ai-Notez/stargazers">
  <img src="https://img.shields.io/github/stars/ShanMade/Ai-Notez?style=social" alt="Stargazers" />
</a>

<a href="https://github.com/ShanMade/Ai-Notez/contributors">
  <img src="https://img.shields.io/github/contributors/ShanMade/Ai-Notez" alt="Contributors" />
</a>

---

## 📝 **Changelog**

### **Latest Updates**
- **v1.0.0** (Current): Initial public release
  - Complete note-taking functionality
  - Firebase integration
  - AI backend support
  - PDF reader and library
  - Offline support

---

## 🎓 **Learning Resources**

### **Technologies Used**
- [Firebase Documentation](https://firebase.google.com/docs)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [USearch Documentation](https://github.com/unum-cloud/usearch)
- [MDN Web Docs](https://developer.mozilla.org/)

### **Similar Projects**
- [Obsidian](https://obsidian.md/) - Local-first note-taking
- [Notion](https://www.notion.so/) - All-in-one workspace
- [Logseq](https://logseq.com/) - Outliner note-taking
- [SiYuan](https://bakaplayer.com/) - Block-based note-taking

---

## 💡 **Tips & Tricks**

### **Keyboard Shortcuts**
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | Create new note |
| `Ctrl/Cmd + S` | Save current note |
| `Ctrl/Cmd + F` | Search notes |
| `Ctrl/Cmd + P` | Open command palette |
| `Ctrl/Cmd + K` | Quick switch between notes |
| `Ctrl/Cmd + D` | Duplicate note |
| `Ctrl/Cmd + Backspace` | Delete note |
| `Ctrl/Cmd + [` | Navigate to previous note |
| `Ctrl/Cmd + ]` | Navigate to next note |

### **Power User Tips**
1. **Use folders** to organize notes by subject or topic
2. **Tag notes** for easy filtering and searching
3. **Favorite important notes** for quick access
4. **Use the library** to manage all your PDFs and documents
5. **Enable dark mode** for comfortable night-time studying
6. **Set a PIN** to protect your notes when sharing your device
7. **Use AI summaries** to quickly review long notes
8. **Record lectures** and transcribe them automatically

---

## 🏆 **Why Notez?**

### **Comparison with Other Tools**

| Feature | Notez | Obsidian | Notion | OneNote |
|---------|-------|----------|--------|---------|
| **Local-First** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Cloud Sync** | ✅ Yes | ❌ (Plugins) | ✅ Yes | ✅ Yes |
| **Offline Support** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **AI Integration** | ✅ Built-in | ❌ (Plugins) | ✅ Built-in | ❌ No |
| **PDF Reader** | ✅ Built-in | ❌ (Plugins) | ❌ No | ✅ Yes |
| **Audio Recording** | ✅ Built-in | ❌ No | ❌ No | ✅ Yes |
| **Semantic Search** | ✅ Yes | ❌ (Plugins) | ❌ No | ❌ No |
| **Open Source** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Self-Hostable** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **PWA Support** | ✅ Yes | ❌ No | ❌ No | ❌ No |

---

## 🎉 **Get Started Today!**

Ready to transform your study experience?

1. **Try the demo**: [https://ai-notez.web.app/](https://ai-notez.web.app/)
2. **Deploy your own**: Follow the deployment guide above
3. **Contribute**: Help make Notez even better!
4. **Spread the word**: Share Notez with fellow students and learners

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/ShanMade">ShanMade</a> | 
  <a href="https://github.com/ShanMade/Ai-Notez">View on GitHub</a> | 
  <a href="https://ai-notez.web.app/">Live Demo</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/ShanMade/Ai-Notez?style=flat-square" alt="Last Commit" />
  <img src="https://img.shields.io/github/commit-activity/m/ShanMade/Ai-Notez?style=flat-square" alt="Commit Activity" />
  <img src="https://img.shields.io/github/repo-size/ShanMade/Ai-Notez?style=flat-square" alt="Repo Size" />
</p>
