const mongoose = require("mongoose");

const stageSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  adminId: { type: Number, default: null },
  telegramGroupId: { type: String, default: null },
  homeworkText: { type: String, default: null },
  scheduleImageId: { type: String, default: null },
});

const classSchema = new mongoose.Schema({
  name: { type: String, required: true },
  stageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Stage",
    required: true,
  },
});
// --- NEW: Prevent duplicate class names in the SAME stage ---
classSchema.index({ name: 1, stageId: 1 }, { unique: true });

const lectureSchema = new mongoose.Schema({
  title: { type: String, required: true },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Class",
    required: true,
  },
  fileId: { type: String, required: true },
  fileType: { type: String, required: true },
  channelMsgId: { type: Number, required: true },
  category: {
    type: String,
    enum: ["theory", "lab"],
    default: "theory",
  },
});

const userSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  name: { type: String },
  username: { type: String },
  stageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Stage",
    default: null,
  },
  role: {
    type: String,
    enum: ["user", "admin", "owner"],
    default: "user",
  },
  managedStageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Stage",
    default: null,
  },
});

const archiveSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
});
const archiveFileSchema = new mongoose.Schema({
  archiveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Archive",
    required: true,
  },
  fileId: { type: String, required: true },
  title: { type: String, required: true },
  channelMsgId: { type: Number, required: true },
});

const creativeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  text: { type: String, required: true },
  channelMsgId: { type: Number, required: true },
});
const creativeFileSchema = new mongoose.Schema({
  creativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Creative",
    required: true,
  },
  fileId: { type: String, required: true },
  title: { type: String, required: true },
  channelMsgId: { type: Number, required: true },
});

const botSettingsSchema = new mongoose.Schema({
  singletonId: { type: String, default: "default", unique: true },
  welcomeMessage: {
    type: String,
    default: "👋 Welcome to Al-Msar Bot!\n\nPlease choose an option below.",
  },
  aboutMessage: {
    type: String,
    default: "This bot was created to help students access their materials.",
  },
});

module.exports = {
  Stage: mongoose.model("Stage", stageSchema),
  Class: mongoose.model("Class", classSchema),
  Lecture: mongoose.model("Lecture", lectureSchema),
  User: mongoose.model("User", userSchema),
  Archive: mongoose.model("Archive", archiveSchema),
  ArchiveFile: mongoose.model("ArchiveFile", archiveFileSchema),
  Creative: mongoose.model("Creative", creativeSchema),
  CreativeFile: mongoose.model("CreativeFile", creativeFileSchema),
  BotSettings: mongoose.model("BotSettings", botSettingsSchema),
};
