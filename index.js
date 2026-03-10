require("dotenv").config();
const { Telegraf, Scenes, session } = require("telegraf");
const mongoose = require("mongoose");
const { User, BotSettings, Stage } = require("./models");
const { mainMenuKeyboard, adminPanelKeyboard, timeIt } = require("./utils");

const {
  addStageWizard,
  addClassWizard,
  addLectureWizard,
  delStageWizard,
  delClassWizard,
  delLectureWizard,
  broadcastWizard,
  addArchiveWizard,
  delArchiveWizard,
  addCreativeWizard,
  delCreativeWizard,
  promoteAdminWizard,
  broadcastGroupWizard,
  editWelcomeMsgWizard,
  editHomeworkWizard,
  editScheduleWizard,
} = require("./adminScenes");

const {
  chooseStageWizard,
  browseClassesWizard,
  viewArchiveWizard,
  viewCreativeWizard,
  suggestWizard,
} = require("./userScenes");

// For sync errors like using undefined variable
process.on("uncaughtException", (err) => {
  console.error("🚨 UNCAUGHT EXCEPTION! 💥 Shutting down...");
  console.error(err.name, err.message, err.stack);

  process.exit(1);
});

mongoose
  .connect(process.env.DB.replace("<DB_PASSWORD>", process.env.DB_PASSWORD))
  .then(() => console.log("MongoDB connected!"));

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

// Global User Middleware
bot.use(async (ctx, next) => {
  console.log(ctx.chat.id);

  // saving users who interact directly with the bot
  if (!ctx.from) return next();

  let user = await User.findOne({ chatId: ctx.from.id });

  const telegramId = ctx.from.id.toString();
  const ownerId = process.env.ADMIN_ID;

  if (!user) {
    user = await User.create({
      chatId: ctx.from.id,
      name: ctx.from.first_name,
      username: ctx.from.username,
      role: telegramId === ownerId ? "owner" : "user",
    });

    const owners = await User.find({ role: "owner" });
    const usersCount = await User.countDocuments();

    owners.forEach((owner) => {
      if (owner.chatId !== user.chatId) {
        bot.telegram.sendMessage(
          owner.chatId,
          `👤 مستخدم جديد: ${user.name} (@${user.username})\n👥 عدد المستخدمين الكلي: ${usersCount}`,
        );
      }
    });
  }

  // Attach the user object directly to ctx so we can use it anywhere
  ctx.state.dbUser = user;

  return next();
});

const stage = new Scenes.Stage([
  addStageWizard,
  addClassWizard,
  addLectureWizard,
  delStageWizard,
  delClassWizard,
  delLectureWizard,
  broadcastWizard,
  chooseStageWizard,
  browseClassesWizard,
  viewArchiveWizard,
  viewCreativeWizard,
  addArchiveWizard,
  delArchiveWizard,
  addCreativeWizard,
  delCreativeWizard,
  promoteAdminWizard,
  broadcastGroupWizard,
  suggestWizard,
  editWelcomeMsgWizard,
  editHomeworkWizard,
  editScheduleWizard,
]);
bot.use(stage.middleware());

// --- ROUTERS ---
bot.start(async (ctx) => {
  let settings = await timeIt(
    "Fetch Bot Settings: Welcome Message",
    BotSettings.findOne({ singletonId: "default" }),
  );

  if (!settings) {
    // Ensure default values are populated if missing
    settings = await BotSettings.create({ singletonId: "default" });
  }

  const welcomeText =
    settings.welcomeMessage.replace(
      "#الاسم",
      ctx.state.dbUser?.name || ctx.state.dbUser?.username,
    ) || "اهلا بيك ببوت سچاچ!";
  ctx.reply(welcomeText, mainMenuKeyboard(ctx), { parse_mode: "Markdown" });
});

bot.command("link", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("🤨 استخدم هذا الامر بداخل بوت مرحلتك..");
  }

  const user = ctx.state.dbUser;

  if (user.role !== "admin" && user.role !== "owner") {
    // ignore normal users
    return;
  }

  if (!user.managedStageId) {
    return ctx.reply(
      "❌ انت ادمن, لكن ما تم تعيين مرحلة الك. تواصل مع صاحب البوت.",
    );
  }

  try {
    let stageId = user.managedStageId;

    const stage = await Stage.findById(stageId);
    if (!stage)
      return new Error("المرحلة المحددة غير موجودة في قاعدة البيانات.");

    stage.telegramGroupId = ctx.chat.id.toString();
    await stage.save();

    return ctx.reply(
      `✅ Success! This group is now officially linked to **${stage.name}**.`,
      `تم. البوت انربط ب ${stage.name} ✅`,
      { parse_mode: "Markdown" },
    );
  } catch (error) {
    console.error(error);
    return ctx.reply("صار خطأ بالربط.. راسل مطور البوت.");
  }
});

bot.command("suggest", (ctx) => ctx.scene.enter("SUGGEST_SCENE"));

bot.hears("🔝 القائمة الرئيسية", (ctx) =>
  ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx)),
);

bot.hears("📚 المحاضرات", async (ctx) => {
  const user = ctx.state.dbUser;
  if (!user || !user.stageId) ctx.scene.enter("CHOOSE_STAGE_SCENE");
  else ctx.scene.enter("BROWSE_CLASSES_SCENE");
});

bot.hears("🔄 تغيير المرحلة", (ctx) => ctx.scene.enter("CHOOSE_STAGE_SCENE"));

bot.hears("⚙️ Admin", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "admin" || role === "owner") {
    ctx.reply("⚙️ Admin", adminPanelKeyboard(ctx));
  }
});

bot.hears("➕ اضافة مرحلة", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("ADD_STAGE_SCENE");
});
bot.hears("➕ اضافة مادة", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "owner" || role === "admin") ctx.scene.enter("ADD_CLASS_SCENE");
});
bot.hears("➕ اضافة محاضرة", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "owner" || role === "admin")
    ctx.scene.enter("ADD_LECTURE_SCENE");
});
bot.hears("❌ حذف مرحلة", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("DEL_STAGE_SCENE");
});
bot.hears("❌ حذف مادة", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "owner" || role === "admin") ctx.scene.enter("DEL_CLASS_SCENE");
});
bot.hears("❌ حذف محاضرة", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "owner" || role === "admin")
    ctx.scene.enter("DEL_LECTURE_SCENE");
});

bot.hears("📢 رسالة جماعية", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("BROADCAST_SCENE");
});
bot.hears("📢 ارسال اعلان للكروب", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "owner" || role === "admin")
    ctx.scene.enter("BROADCAST_GROUP_SCENE");
});

bot.hears("📦 الارشيف", (ctx) => ctx.scene.enter("VIEW_ARCHIVE_SCENE"));
bot.hears("🎨 الادوات المساعدة", (ctx) =>
  ctx.scene.enter("VIEW_CREATIVE_SCENE"),
);

bot.hears("➕ اضافة ارشيف", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("ADD_ARCHIVE_SCENE");
});
bot.hears("➕ اضافة الادوات المساعدة", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("ADD_CREATIVE_SCENE");
});

bot.hears("❌ حذف الارشيف", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("DEL_ARCHIVE_SCENE");
});
bot.hears("❌ حذف الادوات المساعدة", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("DEL_CREATIVE_SCENE");
});

bot.hears("👑 اضافة ادمن", (ctx) => {
  if (ctx.state.dbUser?.role === "owner")
    ctx.scene.enter("PROMOTE_ADMIN_SCENE");
});

bot.hears("✏️ تعديل الرسالة الترحيبية", (ctx) => {
  if (ctx.state.dbUser?.role === "owner") ctx.scene.enter("EDIT_WELCOME_SCENE");
});

bot.hears("📝 تعديل الواجبات", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "owner" || role === "admin")
    ctx.scene.enter("EDIT_HOMEWORK_SCENE");
});

bot.hears("📅 تعديل الجدول", (ctx) => {
  const role = ctx.state.dbUser?.role;
  if (role === "owner" || role === "admin")
    ctx.scene.enter("EDIT_SCHEDULE_SCENE");
});

bot.catch(async (err, ctx) => {
  // 1. Log the error
  console.error(
    `🚨 Global Error for user ${ctx.from?.id} during ${ctx.updateType}:`,
    err,
  );

  // 2. Try to inform the user
  try {
    // If the user was stuck inside a wizard when the error happened kick them out
    // so they dont get permanently stuck in a broken state
    if (ctx.scene) {
      await ctx.scene.leave();
    }

    // Send the error message
    await ctx.reply(
      "صار غلط بالبوت.. جرب مره ثانية او اكتب /start .\n\nاذا استمرت المشكلة راسل مطور البوت 😇.",
    );
  } catch (replyError) {
    // if the user blocked the bot immediately after sending a message
    // or if Telegram's servers are down.
    console.error(
      "❌ Failed to send error message to user.",
      replyError.message,
    );
  }
});

bot.launch();

// Enable graceful stop for keyboard interrupts (Ctrl+C)
process.once("SIGINT", async () => {
  console.log("🛑 SIGINT received. Shutting down...");
  bot.stop("SIGINT");
  await mongoose.connection.close();
  process.exit(0);
});

// Enable graceful stop for server terminations (like from Heroku)
process.once("SIGTERM", async () => {
  console.log("🛑 SIGTERM received. Shutting down...");
  bot.stop("SIGTERM");
  await mongoose.connection.close();
  process.exit(0);
});

//For async errors like failed auth to the db
process.on("unhandledRejection", async (err) => {
  console.log(`Unhandled Rejection! 💥 Shutting down...`);
  console.log(err.name, err.message, err);

  try {
    bot.stop("Unhandled Rejection");

    // Safely close the MongoDB connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("MongoDB connection closed.");
    }
  } catch (shutdownErr) {
    console.error("Error during shutdown:", shutdownErr);
  } finally {
    process.exit(1);
  }
});
