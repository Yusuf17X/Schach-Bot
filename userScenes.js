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

const { timeIt, isCancel, mainMenuKeyboard } = require("./utils");

const showClassesMenu = async (ctx, stageId) => {
  const stage = await Stage.findById(stageId);
  if (!stage) {
    await ctx.reply("⚠️ المرحلة غير موجودة.", mainMenuKeyboard(ctx));
    return ctx.scene.leave();
  }

  // Store stage so next step can handle Homework/Schedule buttons
  ctx.wizard.state.stage = stage;

  const classes = await timeIt(
    "DB: Fetch Classes (User)",
    Class.find({ stageId: stageId }),
  );

  const buttons = classes.map((c) => [c.name]);

  // Inject Homework/Schedule buttons if they exist
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

const chooseStageWizard = new Scenes.WizardScene(
  "CHOOSE_STAGE_SCENE",
  async (ctx) => {
    const stages = await timeIt("DB: Fetch Stages (User)", Stage.find());

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
    const stage = await Stage.findOne({ name: ctx.message?.text });
    if (!stage) return ctx.reply("⚠️ المرحلة غير موجودة، اختار من الازرار.");

    const user = ctx.state.dbUser;
    user.stageId = stage._id;
    await user.save();

    await ctx.reply(`✅ تم اختيار مرحلة ${stage.name}.`);

    return ctx.scene.enter("BROWSE_CLASSES_SCENE");
  },
);

const browseClassesWizard = new Scenes.WizardScene(
  "BROWSE_CLASSES_SCENE",
  async (ctx) => {
    const user = ctx.state.dbUser;

    if (!user.stageId) {
      return ctx.scene.enter("CHOOSE_STAGE_SCENE");
    }

    return await showClassesMenu(ctx, user.stageId);
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    const { stage } = ctx.wizard.state;

    // Handle Homework/Schedule buttons without advancing the wizard step
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
      Lecture.find({ classId: selectedClass._id }).sort({ position: 1 }),
    );

    const theoryLectures = lectures.filter((l) => l.category !== "lab");
    const labLectures = lectures.filter((l) => l.category === "lab");

    ctx.wizard.state.theoryLectures = theoryLectures;
    ctx.wizard.state.labLectures = labLectures;

    // Check if user is admin or owner to show reorder buttons
    const isAdminOrOwner = ctx.state.dbUser?.role === "admin" || ctx.state.dbUser?.role === "owner";

    // Build keyboard based on user role
    let keyboard;
    if (isAdminOrOwner) {
      // Inline keyboard (attached to message) with reorder arrows
      const rows = theoryLectures.map((l, idx) => {
        return [
          Markup.button.callback("▲", `lecture_up_${idx}`),
          Markup.button.callback(l.title, `lecture_select_${idx}`),
          Markup.button.callback("▼", `lecture_down_${idx}`),
        ];
      });
      if (labLectures.length > 0) {
        rows.unshift([Markup.button.callback("🔬 Lab Lectures", "lab_select")]);
      }
      rows.push([
        Markup.button.callback("🔙 العودة الى المواد", "back_to_classes"),
      ]);
      keyboard = Markup.inlineKeyboard(rows);
    } else {
      // Reply keyboard (below user keyboard) - text buttons
      const rows = theoryLectures.map((l) => [l.title]);
      if (labLectures.length > 0) {
        rows.unshift(["🔬 Lab Lectures"]);
      }
      rows.push(["🔙 العودة الى المواد", "🔝 القائمة الرئيسية"]);
      keyboard = Markup.keyboard(rows).resize();
    }

    await ctx.reply(
      `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
      keyboard,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Handle reply keyboard text messages (regular users)
    const text = ctx.message?.text;
    if (text) {
      if (isCancel(text)) {
        await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
        return ctx.scene.leave();
      }
      if (text === "🔙 العودة الى المواد") {
        return ctx.scene.enter("BROWSE_CLASSES_SCENE");
      }

      // Find and send the selected lecture
      const lectures = ctx.wizard.state.theoryLectures;
      const cleanTitle = text.replace(/▲\s*/g, "").replace(/▼\s*/g, "").trim();
      const selectedLecture = lectures.find((l) => l.title === cleanTitle);
      if (!selectedLecture) return ctx.reply("⚠️ اختر محاضرة من القائمة.");

      try {
        if (!selectedLecture.fileId) throw new Error("No file ID");
        const statusMsg = await ctx.reply(`⏳ إرسال ${selectedLecture.title}...`);
        await ctx.telegram.sendDocument(ctx.chat.id, selectedLecture.fileId, {
          caption: selectedLecture.title,
        });
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      } catch (err) {
        console.error("Error sending lecture:", err);
        await ctx.reply("❌ خطأ, تعذر ارسال الملف.");
      }
      return;
    }

    // Handle inline keyboard callback queries (admins/owners)
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;

    // Back to classes
    if (data === "back_to_classes") {
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      return ctx.scene.enter("BROWSE_CLASSES_SCENE");
    }

    // Select lecture (send file)
    if (data.startsWith("lecture_select_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const lectures = ctx.wizard.state.theoryLectures;
      const lecture = lectures[idx];
      if (!lecture) { if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery(); return; }

      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();

      try {
        if (!lecture.fileId) throw new Error("No file ID");
        const statusMsg = await ctx.reply(`⏳ إرسال ${lecture.title}...`);
        await ctx.telegram.sendDocument(ctx.chat.id, lecture.fileId, {
          caption: lecture.title,
        });
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      } catch (err) {
        console.error("Error sending lecture:", err);
        await ctx.reply("❌ خطأ, تعذر ارسال الملف.");
      }
      return;
    }

    // Reorder up/down
    if (data.startsWith("lecture_up_") || data.startsWith("lecture_down_")) {
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      const isUp = data.startsWith("lecture_up_");
      const idx = parseInt(data.split("_")[2], 10);
      const lectures = ctx.wizard.state.theoryLectures;
      const lecture = lectures[idx];
      if (!lecture) return;

      const swapIdx = isUp ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= lectures.length) {
        if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery({ text: "⚠️ لا يمكن التحرك", show_alert: true });
        return;
      }

      // Swap in local array
      const temp = lectures[idx];
      lectures[idx] = lectures[swapIdx];
      lectures[swapIdx] = temp;

      // Reassign ALL positions based on new array order and update DB
      for (let i = 0; i < lectures.length; i++) {
        await Lecture.updateOne({ _id: lectures[i]._id }, { position: i });
        lectures[i].position = i;
      }

      const refreshedTheory = lectures;
      const selectedClassId = ctx.wizard.state.classId;

      const rows = refreshedTheory.map((l, i) => {
        return [
          Markup.button.callback("▲", `lecture_up_${i}`),
          Markup.button.callback(l.title, `lecture_select_${i}`),
          Markup.button.callback("▼", `lecture_down_${i}`),
        ];
      });
      rows.push([
        Markup.button.callback("🔙 العودة الى المواد", "back_to_classes"),
      ]);

      try {
        const className = (await Class.findOne({ _id: selectedClassId }))?.name || "";
        await ctx.editMessageText(
          `📖 ${className}\n\nاختر محاضرة:`,
          Markup.inlineKeyboard(rows)
        );
      } catch (e) {
        console.error("editMessageText failed:", e.message);
      }
      return;
    }
  },
);

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
    if (!archive) return ctx.reply("⚠️ اختر أرشيف صحيح من الازرار.");

    const files = await ArchiveFile.find({ archiveId: archive._id });
    if (files.length === 0) {
      await ctx.reply("⚠️ هذا الأرشيف فارغ.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.reply(`⏳ إرسال ${files.length} ملفات من ${archive.name}...`);
    for (const file of files) {
      try {
        await ctx.telegram.sendDocument(ctx.chat.id, file.fileId);
      } catch {
        await ctx.telegram.sendPhoto(ctx.chat.id, file.fileId).catch(() => {});
      }
    }

    await ctx.reply("✅ تم إرسال جميع الملفات.", mainMenuKeyboard(ctx));
    return ctx.scene.leave();
  },
);

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
    if (!creative) return ctx.reply("⚠️ اختر زر من الازرار الموجودة.");

    try {
      await ctx.telegram.copyMessage(
        ctx.chat.id,
        process.env.CHANNEL_ID,
        creative.channelMsgId,
      );
    } catch (error) {
      console.error("Failed to copy message:", error);
      // Fall back to plain text if the channel message was deleted
      await ctx.reply(`🎨 ${creative.name}\n\n${creative.text}`);
    }

    const files = await CreativeFile.find({ creativeId: creative._id });
    if (files.length > 0) {
      const statusMsg = await ctx.reply(`⏳ إرسال الملفات المرفقة...`);

      for (const file of files) {
        try {
          await ctx.telegram.sendDocument(ctx.chat.id, file.fileId);
        } catch {
          await ctx.telegram.sendPhoto(ctx.chat.id, file.fileId).catch(() => {});
        }
      }

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch {
        // Ignore failure to delete status message
      }
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

    const suggestion = ctx.message?.text;
    if (!suggestion) {
      await ctx.reply("⚠️ اكتب اقتراحك ك نص بس.", mainMenuKeyboard(ctx));
      return;
    }

    const owners = await User.find({ role: "owner" });

    for (const owner of owners) {
      try {
        await ctx.telegram.sendMessage(
          owner.chatId,
          `💡 New suggestion from ${ctx.from.first_name || ctx.from.id} (@${ctx.from.username}):`,
        );
        await ctx.telegram.copyMessage(
          owner.chatId,
          ctx.chat.id,
          ctx.message.message_id,
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
