# Schach Bot (بوت سچاچ)

Telegram bot for managing university educational content using **Node.js**, **Telegraf**, and **MongoDB**.

Bot username on telegram: @BITSchachBot

---

## ⚡ Quick Start

```bash
git clone https://github.com/yourusername/bit-schach-bot.git
cd bit-schach-bot
npm install
```

Create `.env`:

```env
BOT_TOKEN=your_telegram_bot_token
ADMIN_ID=your_telegram_user_id
CHANNEL_ID=@your_private_channel
DB=mongodb+srv://user:<DB_PASSWORD>@cluster.mongodb.net/dbname DB_PASSWORD=your_mongo_password
```

Run:

```bash
npm start
```

---

## ✨ Features

### 👥 Role System

- Owner: full system control
- Admin: manage assigned stage
- User: browse content and downloads

---

### 📚 Content Management

- Lecture system organized as **Stage → Class → Lecture**
- Theory / Lab categorization
- Batch upload support
- Automatic backup to private Telegram channel
- Stage-based notifications

---

### 📦 Archive System

- Create archive categories
- Upload multiple files (docs, images, videos)
- Bulk download support

---

### 🎨 Creative Content

- Topic-based resources
- Text + media support
- Attach multiple files per topic

---

### 📝 Homework & Schedule

- Stage homework management
- Schedule image uploads
- Quick access via bot & group buttons

---

### 📢 Broadcast System

- Global broadcast (all users)
- Stage-level group broadcast

---

### 🔗 Telegram Integration

- Link groups to stages via `/link`
- `/suggest` for feedback
- Inline homework button in groups
- Smart bot mentions in chats

---

### ⚙️ Bot Settings

- Custom welcome message support
- Dynamic name placeholder (`#الاسم`)
- Heroku deployment ready

---

## 🧠 Tech Stack

- Node.js
- Telegraf v4
- MongoDB + Mongoose
- Telegram Bot API
- Heroku

---

## 🗄️ Data Models

- **Stage** — academic level + group link + homework
- **Class** — subject under stage
- **Lecture** — file-based lecture (theory/lab)
- **User** — roles + permissions
- **Archive / ArchiveFile** — file collections
- **Creative / CreativeFile** — content topics
- **BotSettings** — global config

---

## 📌 Notes

- Files are backed up permanently in a private Telegram channel
- Designed for multi-stage university structure
- Optimized for Telegram group workflows

---

## 🚀 Deployment

Works out of the box on **Heroku** or any Node.js host.
