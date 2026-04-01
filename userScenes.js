const { Scenes, Markup } = require("telegraf");
const prisma = require("./models");

const { timeIt, isCancel, mainMenuKeyboard } = require("./utils");

const showClassesMenu = async (ctx, stageId) => {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } });
  if (!stage) {
    await ctx.reply("⚠️ المرحلة غير موجودة.", mainMenuKeyboard(ctx));
    return ctx.scene.leave();
  }

  // Save stage to wizard state so the next step can use it for Homework/Schedule
  ctx.wizard.state.stage = stage;

  const classes = await timeIt(
    "DB: Fetch Classes (User)",
    prisma.class.findMany({ where: { stageId: stageId } }),
  );

  const buttons = classes.map((c) => [c.name]);

  // --- Inject Homework/Schedule if they exist ---
  const updatesRow = [];
  if (stage.scheduleImageId) updatesRow.push("📅 الجدول");
  if (stage.homeworkText) updatesRow.push("📝 الواجبات");

  if (updatesRow.length > 0) buttons.unshift(updatesRow);
  buttons.push(["🔝 القائمة الرئيسية"]);

  await ctx.reply(
    `📚 مواد ${stage.name} - اختر مادة:`,
    Markup.keyboard(buttons).resize(),
  );

  return ctx.wizard.next();
};

// --- CHOOSE STAGE SCENE ---
const chooseStageWizard = new Scenes.WizardScene(
  "CHOOSE_STAGE_SCENE",
  async (ctx) => {
    const stages = await timeIt("DB: Fetch Stages (User)", prisma.stage.findMany());

    if (stages.length === 0) {
      await ctx.reply("⚠️ لا توجد مراحل حالياً.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.reply(
      "اختار مرحلتك 😄\nتكدر تغيرها بعدين..",
      Markup.keyboard([
        ...stages.map((s) => [s.name]),
        ["🔝 القائمة الرئيسية"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }
    const stage = await prisma.stage.findFirst({ where: { name: ctx.message?.text } });
    if (!stage) return ctx.reply("⚠️ المرحلة غير موجودة، اختار من الازرار.");

    const user = ctx.state.dbUser;
    ctx.state.dbUser.stageId = stage.id;
    await prisma.user.update({ where: { id: user.id }, data: { stageId: stage.id } });

    await ctx.reply(`✅ تم اختيار مرحلة ${stage.name}.`);

    return ctx.scene.enter("BROWSE_CLASSES_SCENE");
  },
);

// --- BROWSE CLASSES SCENE ---
const browseClassesWizard = new Scenes.WizardScene(
  "BROWSE_CLASSES_SCENE",
  // STEP 1 (Index 0): Check if user has a stage
  async (ctx) => {
    const user = ctx.state.dbUser;

    if (!user.stageId) {
      return ctx.scene.enter("CHOOSE_STAGE_SCENE");
    }

    // USER ALREADY HAS STAGE: Show classes instantly
    return await showClassesMenu(ctx, user.stageId);
  },
  // STEP 2 (Index 1): Handle Class Click OR Homework/Schedule Clicks
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    const stage = ctx.wizard.state.stage;

    // --- Intercept Homework/Schedule Clicks (Stay in Step 2) ---
    if (text === "📝 الواجبات" && stage.homeworkText) {
      await ctx.reply(`📝 الواجبات:\n\n${stage.homeworkText}`);
      return;
    }
    if (text === "📅 الجدول" && stage.scheduleImageId) {
      await ctx.telegram.sendPhoto(ctx.chat.id, stage.scheduleImageId);
      return;
    }

    // --- Process Class Selection ---
    const selectedClass = await prisma.class.findFirst({
      where: { name: text, stageId: stage.id },
    });
    if (!selectedClass) return ctx.reply("⚠️ اختار كلمة صحيحة من الازرار.");

    ctx.wizard.state.classId = selectedClass.id;

    const lectures = await timeIt(
      "DB: Fetch Lectures (User)",
      prisma.lecture.findMany({ where: { classId: selectedClass.id } }),
    );

    const theoryLectures = lectures.filter((l) => l.category !== "lab");
    const labLectures = lectures.filter((l) => l.category === "lab");

    ctx.wizard.state.theoryLectures = theoryLectures;
    ctx.wizard.state.labLectures = labLectures;

    const lectureButtons = theoryLectures.map((l) => [l.title]);

    if (labLectures.length > 0) {
      lectureButtons.unshift(["🔬 Lab Lectures"]);
    }

    lectureButtons.push(["🔙 العودة الى المواد", "🔝 القائمة الرئيسية"]);

    await ctx.reply(
      `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
      Markup.keyboard(lectureButtons).resize(),
    );
    return ctx.wizard.next();
  },
  // STEP 3 (Index 2): Handle Lecture Download OR Lab Folder Navigation
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    if (text === "🔙 العودة الى المواد") {
      return ctx.scene.enter("BROWSE_CLASSES_SCENE");
    }

    // --- Intercept "Back to Lectures" ---
    if (text === "🔙 العودة الى المحاضرات") {
      const theoryButtons = ctx.wizard.state.theoryLectures.map((l) => [
        l.title,
      ]);
      if (ctx.wizard.state.labLectures.length > 0) {
        theoryButtons.unshift(["🔬 Lab Lectures"]);
      }
      theoryButtons.push(["🔙 العودة الى المواد", "🔝 القائمة الرئيسية"]);

      await ctx.reply("📖 المحاضرات:", Markup.keyboard(theoryButtons).resize());
      return;
    }

    // --- Intercept Lab Folder Click ---
    if (
      text === "🔬 Lab Lectures" &&
      ctx.wizard.state.labLectures?.length > 0
    ) {
      const labButtons = ctx.wizard.state.labLectures.map((l) => [l.title]);
      labButtons.push(["🔙 العودة الى المحاضرات", "🔝 القائمة الرئيسية"]);

      await ctx.reply(
        "🔬 Lab Lectures:\n\nاختار محاضرة:",
        Markup.keyboard(labButtons).resize(),
      );
      return;
    }

    // --- Process Lecture Download ---
    const lecture = await prisma.lecture.findFirst({
      where: { classId: ctx.wizard.state.classId, title: text },
    });

    if (!lecture) return ctx.reply("⚠️ اختار محاضرة من الازرار.");

    const statusMsg = await ctx.reply(`⏳ إرسال ${lecture.title}...`);

    try {
      await timeIt(
        `TG: Send file ${lecture.title}`,
        ctx.telegram.sendDocument(ctx.chat.id, lecture.fileId, {
          caption: lecture.title,
        }),
      );
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ خطأ, تعذر ارسال الملف.");
    }

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (e) {}
  },
);

// --- VIEW ARCHIVE SCENE ---
const viewArchiveWizard = new Scenes.WizardScene(
  "VIEW_ARCHIVE_SCENE",
  async (ctx) => {
    const archives = await timeIt("DB: Fetch Archives", prisma.archive.findMany());
    if (archives.length === 0) {
      await ctx.reply("هذا القسم فارغ حاليا....", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.reply(
      "📦 اختر أرشيف:",
      Markup.keyboard([
        ...archives.map((a) => [a.name]),
        ["🔝 القائمة الرئيسية"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    const archive = await prisma.archive.findFirst({ where: { name: ctx.message.text } });
    if (!archive) return ctx.reply("⚠️ اختر أرشيف صحيح من الازرار."); // FIX: Added reply

    const files = await prisma.archiveFile.findMany({ where: { archiveId: archive.id } });
    if (files.length === 0) {
      await ctx.reply("⚠️ هذا الأرشيف فارغ.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.reply(`⏳ إرسال ${files.length} ملفات من ${archive.name}...`);
    for (const file of files) {
      try {
        await ctx.telegram.sendDocument(ctx.chat.id, file.fileId);
      } catch (e) {
        await ctx.telegram.sendPhoto(ctx.chat.id, file.fileId).catch(() => {});
      }
    }

    await ctx.reply("✅ تم إرسال جميع الملفات.", mainMenuKeyboard(ctx));
    return ctx.scene.leave(); // FIX: Exit scene so user doesn't get trapped
  },
);

// --- VIEW CREATIVE SCENE ---
const viewCreativeWizard = new Scenes.WizardScene(
  "VIEW_CREATIVE_SCENE",
  async (ctx) => {
    const creatives = await timeIt("DB: Fetch Creatives", prisma.creative.findMany());
    if (creatives.length === 0) {
      await ctx.reply("هذا القسم فارغ حاليا....", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.reply(
      "🎨 اختر زر:",
      Markup.keyboard([
        ...creatives.map((c) => [c.name]),
        ["🔝 القائمة الرئيسية"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    const creative = await prisma.creative.findFirst({ where: { name: ctx.message.text } });
    if (!creative) return ctx.reply("⚠️ اختر زر من الازرار الموجودة.");

    try {
      await ctx.telegram.copyMessage(
        ctx.chat.id, // 1. Where it's going (The Student)
        process.env.CHANNEL_ID, // 2. Where it is right now (Your Storage Group ID)
        creative.channelMsgId, // 3. The ID of the message saved in your database
      );
    } catch (error) {
      console.error("Failed to copy message:", error);
      // Fallback just in case the message was deleted from the storage group
      await ctx.reply(`🎨 ${creative.name}\n\n${creative.text}`);
    }

    // --- The rest of your file sending code stays exactly the same! ---
    const files = await prisma.creativeFile.findMany({ where: { creativeId: creative.id } });
    if (files.length > 0) {
      const statusMsg = await ctx.reply(`⏳ إرسال الملفات المرفقة...`);

      for (const file of files) {
        try {
          await ctx.telegram.sendDocument(ctx.chat.id, file.fileId);
        } catch (e) {
          await ctx.telegram
            .sendPhoto(ctx.chat.id, file.fileId)
            .catch(() => {});
        }
      }

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}
    }
  },
);

const suggestWizard = new Scenes.WizardScene(
  "SUGGEST_SCENE",
  async (ctx) => {
    ctx.reply(
      "💡 هل لديك اقتراح لتحسين البوت أو تريد تساعدنا بالبوت؟ دز فكرتك هنا!",
      Markup.keyboard([["🔝 القائمة الرئيسية"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // 1. Check if the message is actually text
    const suggestion = ctx.message?.text;
    if (!suggestion) {
      await ctx.reply("⚠️ اكتب اقتراحك ك نص بس.", mainMenuKeyboard(ctx));
      return;
    }

    const owners = await prisma.user.findMany({ where: { role: "owner" } });

    for (const owner of owners) {
      try {
        await ctx.telegram.sendMessage(
          owner.chatId,
          `💡 New suggestion from ${ctx.from.first_name || ctx.from.id} (@${ctx.from.username}):\n\n${suggestion}`,
        );
      } catch (error) {
        console.error(`Could not send suggestion to ${owner.chatId}:`, error);
      }
    }

    await ctx.reply("✅ شكرا على اقتراحك!", mainMenuKeyboard(ctx));
    return ctx.scene.leave();
  },
);

module.exports = {
  chooseStageWizard,
  browseClassesWizard,
  viewArchiveWizard,
  viewCreativeWizard,
  suggestWizard,
};
