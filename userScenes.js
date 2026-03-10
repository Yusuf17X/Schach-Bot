const { Scenes, Markup } = require("telegraf");
const {
  Stage,
  Class,
  Lecture,
  User,
  Archive,
  ArchiveFile,
  Creative,
  CreativeFile,
} = require("./models");

const {
  timeIt,
  isCancel,
  mainMenuKeyboard,
  showClassesMenu,
} = require("./utils");

const chooseStageWizard = new Scenes.WizardScene(
  "CHOOSE_STAGE_SCENE",
  async (ctx) => {
    const stages = await timeIt("DB: Fetch Stages (User)", Stage.find());
    ctx.reply(
      "🎓 اختر مرحلتك:",
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
    const stage = await Stage.findOne({ name: ctx.message.text });
    if (!stage) return ctx.reply("⚠️ المرحلة غير موجودة.");

    await timeIt(
      "DB: Update User Stage",
      User.updateOne(
        { chatId: ctx.chat.id.toString() },
        { stageId: stage._id },
      ),
    );
    ctx.reply(`✅ تم اختيار مرحلة ${stage.name}.`);
    return ctx.scene.enter("BROWSE_CLASSES_SCENE");
  },
);

const browseClassesWizard = new Scenes.WizardScene(
  "BROWSE_CLASSES_SCENE",
  // STEP 0: Check if user has a stage
  async (ctx) => {
    // We use the dbUser we saved in your global middleware earlier!
    const user = ctx.state.dbUser;

    if (!user.stageId) {
      // USER HAS NO STAGE: Fetch stages and show them buttons
      const stages = await Stage.find({});
      if (stages.length === 0) {
        await ctx.reply("⚠️ خطأ بتحميل المراحل.", mainMenuKeyboard(ctx));
        return ctx.scene.leave();
      }

      const stageButtons = stages.map((s) => [s.name]);
      stageButtons.push(["🔝 القائمة الرئيسية"]);

      await ctx.reply(
        "اختار مرحلتك 😄\nتكدر تغيرها بعدين..",
        Markup.keyboard(stageButtons).resize(),
      );

      // Move to Step 1 to wait for their stage choice
      return ctx.wizard.next();
    }

    // USER ALREADY HAS STAGE: Show classes instantly and skip Step 1
    return await showClassesMenu(ctx, Stage, user.stageId);
  },
  // STEP 1: Handle Stage Selection (Only runs if they didn't have a stage)
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    const selectedStage = await Stage.findOne({ name: text });
    if (!selectedStage) return ctx.reply("⚠️ اختار مرحلة من الازرار الموجودة.");

    // Save their choice permanently in the database
    const user = ctx.state.dbUser;
    user.stageId = selectedStage._id;
    await user.save();

    await ctx.reply(`✅ تم حفظ مرحلتك (${selectedStage.name})!`);

    // Now immediately show them their classes and jump to Step 2
    return await showClassesMenu(ctx, Stage, selectedStage._id);
  },
  // STEP 2: Handle Class Click OR Homework/Schedule Clicks
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
    const selectedClass = await Class.findOne({
      name: text,
      stageId: stage._id,
    });
    if (!selectedClass) return ctx.reply("⚠️ اختار كلمة صحيحة من الازرار.");

    ctx.wizard.state.classId = selectedClass._id;

    const lectures = await timeIt(
      "DB: Fetch Lectures (User)",
      Lecture.find({ classId: selectedClass._id }),
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

    ctx.reply(
      `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
      Markup.keyboard(lectureButtons).resize(),
    );
    return ctx.wizard.next();
  },
  // STEP 3: Handle Lecture Download OR Lab Folder Navigation
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
    const lecture = await Lecture.findOne({
      classId: ctx.wizard.state.classId,
      title: text,
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
    const archives = await timeIt("DB: Fetch Archives", Archive.find());
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

    const archive = await Archive.findOne({ name: ctx.message.text });
    if (!archive) return ctx.reply("⚠️ اختر أرشيف صحيح من الازرار."); // FIX: Added reply

    const files = await ArchiveFile.find({ archiveId: archive._id });
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
    const creatives = await timeIt("DB: Fetch Creatives", Creative.find());
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

    const creative = await Creative.findOne({ name: ctx.message.text });
    if (!creative) return ctx.reply("⚠️ اختر زر من الازرار الموجودة."); // FIX: Added reply

    // Send the text message first (we keep this one permanently)
    await ctx.reply(`🎨 ${creative.name}\n\n${creative.text}`);

    const files = await CreativeFile.find({ creativeId: creative._id });
    if (files.length > 0) {
      // 1. Capture the loading message
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

      // 2. Delete the loading message once finished
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}
    }

    await ctx.reply("✅ تم الانتهاء.", mainMenuKeyboard(ctx));
    return ctx.scene.leave(); // FIX: Exit scene so user doesn't get trapped
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

    const suggestion = ctx.message.text;

    const adminId = process.env.ADMIN_ID;

    await ctx.telegram.sendMessage(
      adminId,
      `💡 New suggestion from ${ctx.from.username || ctx.from.first_name || ctx.from.id} (@${ctx.from.username}):\n\n${suggestion}`,
    );

    ctx.reply("✅ شكرا على اقتراحك!", mainMenuKeyboard(ctx));
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
