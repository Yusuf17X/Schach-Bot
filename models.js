const mongoose = require("mongoose");

const stageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    adminId: { type: Number, default: null },
    telegramGroupId: { type: String, default: null, trim: true, index: true },
    homeworkText: { type: String, default: null, trim: true },
    scheduleImageId: { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
  },
);

const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    stageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stage",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Prevent duplicate class names in the SAME stage
classSchema.index({ name: 1, stageId: 1 }, { unique: true });

const lectureSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
      index: true,
    },
    fileId: { type: String, required: true, trim: true },
    fileType: { type: String, required: true, trim: true, lowercase: true },
    channelMsgId: { type: Number, required: true },
    category: {
      type: String,
      enum: ["theory", "lab"],
      default: "theory",
      index: true,
    },
    position: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

const userSchema = new mongoose.Schema(
  {
    chatId: { type: Number, required: true, unique: true },
    name: { type: String, trim: true },
    username: { type: String, trim: true },
    stageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stage",
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "admin", "owner"],
      default: "user",
      index: true,
    },
    managedStageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stage",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Role check helpers
userSchema.virtual("isAdmin").get(function () {
  return this.role === "admin" || this.role === "owner";
});

userSchema.virtual("isOwner").get(function () {
  return this.role === "owner";
});

const archiveSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    position: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

const archiveFileSchema = new mongoose.Schema(
  {
    archiveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Archive",
      required: true,
      index: true,
    },
    fileId: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    channelMsgId: { type: Number, required: true },
  },
  {
    timestamps: true,
  },
);

const creativeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    text: { type: String, required: true, trim: true },
    channelMsgId: { type: Number, required: true },
    position: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

const creativeFileSchema = new mongoose.Schema(
  {
    creativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Creative",
      required: true,
      index: true,
    },
    fileId: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    channelMsgId: { type: Number, required: true },
  },
  {
    timestamps: true,
  },
);

const botSettingsSchema = new mongoose.Schema(
  {
    singletonId: { type: String, default: "default", unique: true },
    welcomeMessage: {
      type: String,
      default: "👋 Welcome to Al-Msar Bot!\n\nPlease choose an option below.",
      trim: true,
    },
    aboutMessage: {
      type: String,
      default: "This bot was created to help students access their materials.",
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

// Fetch or initialize singleton settings
botSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ singletonId: "default" });
  if (!settings) {
    settings = await this.create({ singletonId: "default" });
  }
  return settings;
};

module.exports = {
  Stage: mongoose.models.Stage || mongoose.model("Stage", stageSchema),
  Class: mongoose.models.Class || mongoose.model("Class", classSchema),
  Lecture: mongoose.models.Lecture || mongoose.model("Lecture", lectureSchema),
  User: mongoose.models.User || mongoose.model("User", userSchema),
  Archive: mongoose.models.Archive || mongoose.model("Archive", archiveSchema),
  ArchiveFile:
    mongoose.models.ArchiveFile ||
    mongoose.model("ArchiveFile", archiveFileSchema),
  Creative:
    mongoose.models.Creative || mongoose.model("Creative", creativeSchema),
  CreativeFile:
    mongoose.models.CreativeFile ||
    mongoose.model("CreativeFile", creativeFileSchema),
  BotSettings:
    mongoose.models.BotSettings ||
    mongoose.model("BotSettings", botSettingsSchema),
};

