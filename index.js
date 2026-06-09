require("dotenv").config();
const { Telegraf, Scenes, session, Markup } = require("telegraf");
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

// Crash on unrecoverable sync errors
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

// // --- MAINTENANCE MODE MIDDLEWARE ---
// bot.use(async (ctx, next) => {
//   // const maintenanceMessage =
//   //   "⚠️ البوت حالياً تحت الصيانة بسبب تحديثات في السيرفر. نعتذر عن الازعاج ونعود قريباً!";
//   const maintenanceMessage = "البوت تحت الصيانة..";

//   try {
//     // If they send a text/media message
//     if (ctx.chat.type === "private" && ctx.message) {
//       await ctx.reply(maintenanceMessage);
//     }
//     // If they click an inline button (like your homework button)
//     else if (ctx.callbackQuery) {
//       await ctx.answerCbQuery();
//     }
//   } catch (error) {
//     console.error("Maintenance message error:", error);
//   }

//   // CRITICAL: We do NOT call next() here.
//   // This acts as a brick wall, stopping the bot from reading the database.
// });

// Global User Middleware
bot.use(async (ctx, next) => {
  console.log(ctx.from.id, ctx.chat?.id);

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

    const usersCount = await User.countDocuments();
    const owners = await User.find({ role: "owner" });

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

// Route definitions
// Hide slash commands in groups
bot.telegram.setMyCommands([], {
  scope: { type: "all_group_chats" },
});

bot.telegram.setMyCommands(
  [
    { command: "start", description: "تشغيل البوت" },
    {
      command: "suggest",
      description: "اقتراح ميزة لتطوير البوت او الابلاغ عن مشكلة",
    },
  ],
  {
    scope: { type: "all_private_chats" },
  },
);

bot.start(async (ctx) => {
  let settings = await timeIt(
    "Fetch Bot Settings: Welcome Message",
    BotSettings.findOne({ singletonId: "default" }),
  );

  if (!settings) {
    settings = await BotSettings.create({ singletonId: "default" });
  }

  const welcomeText =
    settings.welcomeMessage.replace(
      "#الاسم",
      ctx.state.dbUser?.name || ctx.state.dbUser?.username || "",
    ) || "اهلا بيك ببوت سچاچ!";

  const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

  if (!isGroup) {
    ctx.reply(welcomeText, mainMenuKeyboard(ctx), {
      entities: ctx.message.entities,
    });
  } else {
    ctx.reply(
      "اهلاً بيك #الاسم 👋".replace(
        "#الاسم",
        ctx.state.dbUser?.name || ctx.state.dbUser?.username || "",
      ),
      Markup.inlineKeyboard([
        [Markup.button.callback("📝 الواجبات", "action_homework")],
      ]),
      {
        entities: ctx.message.entities,
      },
    );
  }
});

bot.command("link", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("🤨 استخدم هذا الامر بكروب مرحلتك..");
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
      throw new Error("المرحلة المحددة غير موجودة في قاعدة البيانات.");

    stage.telegramGroupId = ctx.chat.id.toString();
    await stage.save();

    return ctx.reply(`تم. البوت انربط ب ${stage.name} ✅`);
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

bot.hears(/سجاج|سچاچ|@BITSchachBot/, async (ctx) => {
  const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
  if (!isGroup) return; // only reply to these keywords in groups, ignore in private chats

  const replies = [
    "سچاچ بالخدمة ؟🤓",
    "نعم؟ شتريد؟ 👀",
    "هااا كافي دوختني 😵‍💫",
    "شلونك؟ عينك على شي؟ 😏",
    "تفضل؟ شتريد؟ 🤨",
    "يمعود شتريد؟ 🧐",
    "حاضر؟ أمرك؟ 😎",
    "لا هلا ، شتريد تسوي؟ 😜",
    "ها يمعود؟ شكد منتظرك 😤",
    "شفتك؟ شتريد؟ 😆",
    "هاا؟ خلصت سوالفك؟ 🙄",
    "تفضل أمرني 😊",
    "سمعت اسمي 👀",
    "شتريد خلّصني؟ 🤬",
    "هاا؟ مو كافي؟ 😤",
    "يمعود روح نام 🙄",
    "يابه دروحح 🙄",
    "كضيتها تسخت هسه تجي ؟ 🤣",
  ];

  const randomReply = replies[Math.floor(Math.random() * replies.length)];

  await ctx.reply(
    randomReply,
    Markup.inlineKeyboard([
      [Markup.button.callback("📝 الواجبات", "action_homework")],
    ]),
  );
});

bot.action("action_homework", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const isGroup =
      ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    if (!isGroup) return;

    // Look up the Stage linked to this group
    const stage = await Stage.findOne({
      telegramGroupId: ctx.chat.id.toString(),
    });

    if (!stage) {
      return ctx.reply(
        "⚠️ هذا الكروب غير مربوط بأي مرحلة حالياً. يرجى من الأدمن استخدام امر /link.",
      );
    }

    const homeworkText =
      stage.homeworkText || "لا توجد واجبات مضافة حالياً لهذي المرحلة 🥳.";

    await ctx.reply(`📚 واجبات ${stage.name}:\n\n${homeworkText}`);
  } catch (error) {
    console.error("Error in action_homework:", error);

    await ctx
      .answerCbQuery("❌ صار خطأ بجلب الواجبات.. جرب مرة ثانية.", {
        show_alert: true,
      })
      .catch(() => null);
  }
});

bot.catch(async (err, ctx) => {
  console.error(
    `🚨 Global Error for user ${ctx.from?.id} during ${ctx.updateType}:`,
    err,
  );

  try {
    // Leave the wizard if active so the user isn't permanently stuck
    if (ctx.scene) {
      await ctx.scene.leave();
    }

    await ctx.reply(
      "صار غلط بالبوت.. جرب مره ثانية او اكتب /start .\n\nاذا استمرت المشكلة راسل مطور البوت 😇.",
    );
  } catch (replyError) {
    // Fires if the user blocked the bot or Telegram is down
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

// Crash on unhandled async errors (e.g. DB auth failure)
process.on("unhandledRejection", async (err) => {
  console.log(`Unhandled Rejection! 💥 Shutting down...`);
  console.log(err.name, err.message, err);

  try {
    bot.stop("Unhandled Rejection");

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
