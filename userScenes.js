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

    // Build lecture buttons as reply keyboard rows
    // Each lecture gets its own row
    const lectureButtons = theoryLectures.map((l, idx) => {
      const row = [];

      if (isAdminOrOwner) {
        // Three buttons: up arrow, lecture name, down arrow
        row.push("▲");
        row.push(l.title);
        row.push("▼");
      } else {
        // One button: lecture name (sends text to bot)
        row.push(l.title);
      }

      return row;
    });

    if (labLectures.length > 0) {
      // Add Lab Lectures header row
      const labHeader = ["🔬 Lab Lectures"];
      lectureButtons.unshift(labHeader);
    }

    // Add main menu row
    const menuRow = ["🔙 العودة الى المواد", "🔝 القائمة الرئيسية"];
    lectureButtons.push(menuRow);

    // Use reply keyboard (buttons appear below user keyboard)
    const keyboard = Markup.keyboard(lectureButtons).resize();

    await ctx.reply(
      `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
      keyboard,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Handle text messages for lecture selection
    const text = ctx.message?.text;

    if (!text) return;

    // Handle cancel
    if (isCancel(text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // Handle back to classes list
    if (text === "🔙 العودة الى المواد") {
      return ctx.scene.enter("BROWSE_CLASSES_SCENE");
    }

    // Handle Homework/Schedule buttons
    const wstage = ctx.wizard.state.stage;
    if (text === "📝 الواجبات" && wstage && wstage.homeworkText) {
      await ctx.reply(`📝 الواجبات:\n\n${wstage.homeworkText}`);
      return;
    }
    if (text === "📅 الجدول" && wstage && wstage.scheduleImageId) {
      await ctx.telegram.sendPhoto(ctx.chat.id, wstage.scheduleImageId);
      return;
    }

    // --- Process Lecture Selection ---
    const selectedClass = ctx.wizard.state.classId;
    if (!selectedClass) return ctx.reply("⚠️ لم يتم تحديد مادة.");

    const lectures = ctx.wizard.state.theoryLectures;

    // Find the selected lecture by title
    // Remove reorder arrows if present (for admin/owner view)
    const cleanTitle = text.replace(/▲/g).replace(/▼/g).trim();
    const selectedLecture = lectures.find((l) => l.title === cleanTitle);

    if (!selectedLecture) return ctx.reply("⚠️ اختر محاضرة من القائمة.");

    // Send the lecture file
    try {
      if (!selectedLecture.fileId) throw new Error("No file ID for this lecture");

      const statusMsg = await ctx.reply(`⏳ إرسال ${selectedLecture.title}...`);

      await timeIt(
        `TG: Send file ${selectedLecture.title}`,
        ctx.telegram.sendDocument(ctx.chat.id, selectedLecture.fileId, {
          caption: selectedLecture.title,
        }),
      );

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch {
        // Ignore failure to delete status message
      }
    } catch (err) {
      console.error("Error sending lecture:", err);
      await ctx.reply("❌ خطأ, تعذر ارسال الملف.");
    }
  },
async (ctx) => {
    // Handle callback queries for lecture reordering
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;

      // Skip if not a lecture reorder callback
      if (!data.startsWith("lecture_") && data !== "lab_up" && data !== "lab_down") {
        return;
      }

      // Acknowledge the callback query immediately
      if (typeof ctx.answerCallbackQuery === "function") {
        await ctx.answerCallbackQuery();
      }

      const user = ctx.state.dbUser;
      const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";

      if (!isAdminOrOwner) {
        return;
      }

      if (data === "lab_up" || data === "lab_down") {
        if (typeof ctx.answerCallbackQuery === "function") {
          await ctx.answerCallbackQuery("ℹ️ Use individual lecture buttons to reorder");
        }
        return;
      }

      // Extract lecture index from callback data: lecture_up_0, lecture_down_3, etc.
      const parts = data.split("_");
      const action = parts[1]; // "up" or "down"
      const index = parseInt(parts[2], 10);

      if (isNaN(index)) {
        if (typeof ctx.answerCallbackQuery === "function") {
          await ctx.answerCallbackQuery("⚠️ Invalid lecture index");
        }
        return;
      }

      const lectures = ctx.wizard.state.theoryLectures;
      if (index < 0 || index >= lectures.length) {
        await ctx.answerCallbackQuery("⚠️ Lecture not found");
        return;
      }

      const lecture = lectures[index];
      if (!lecture) {
        await ctx.answerCallbackQuery("⚠️ Lecture not found");
        return;
      }

      const classId = ctx.wizard.state.classId;

      if (action === "up") {
        // Move lecture up - swap position with previous
        if (lecture.position <= 0) {
          await ctx.answerCallbackQuery("🔝 Already at top");
          return;
        }

        const prevLecture = await Lecture.findOne({
          classId,
          position: lecture.position - 1,
        });
        if (!prevLecture) {
          await ctx.answerCallbackQuery("⚠️ Error finding previous lecture");
          return;
        }

        // Swap positions
        const temp = lecture.position;
        lecture.position = prevLecture.position;
        prevLecture.position = temp;
        await lecture.save();
        await prevLecture.save();

        await ctx.answerCallbackQuery("✅ Moved up");
      } else if (action === "down") {
        // Move lecture down - swap position with next
        const allLectures = await Lecture.find({ classId });
        const sortedLectures = allLectures.sort((a, b) => a.position - b.position);
        const lastLecture = sortedLectures[sortedLectures.length - 1];

        if (lastLecture && lecture.position >= lastLecture.position) {
          await ctx.answerCallbackQuery("🔝 Already at bottom");
          return;
        }

        const nextLecture = await Lecture.findOne({
          classId,
          position: lecture.position + 1,
        });

        if (!nextLecture) {
          await ctx.answerCallbackQuery("⚠️ Error finding next lecture");
          return;
        }

        // Swap positions
        const temp = lecture.position;
        lecture.position = nextLecture.position;
        nextLecture.position = temp;
        await lecture.save();
        await nextLecture.save();

        await ctx.answerCallbackQuery("✅ Moved down");
      }

      // Refresh the lecture display
      const selectedClass = await Class.findOne({
        _id: ctx.wizard.state.classId,
      });

      if (!selectedClass) {
        return;
      }

      const refetchLectures = await timeIt(
        "DB: Refresh Lectures",
        Lecture.find({ classId: selectedClass._id }).sort({ position: 1 }),
      );

      const refetchTheory = refetchLectures.filter((l) => l.category !== "lab");
      const refetchLab = refetchLectures.filter((l) => l.category === "lab");

      // Rebuild buttons with new positions
      const isAdmin = ctx.state.dbUser?.role === "admin" || ctx.state.dbUser?.role === "owner";
      const refetchButtons = refetchTheory.map((l, idx) => {
        const base = [l.title];
        if (isAdmin) {
          base.push(
            Markup.button.callback(`▲${idx}`, `lecture_up_${idx}`),
            Markup.button.callback(`▼${idx}`, `lecture_down_${idx}`)
          );
        }
        return base;
      });

      if (refetchLab.length > 0) {
        const labHeader = ["🔬 Lab Lectures"];
        if (isAdmin) {
          labHeader.push(
            Markup.button.callback("▲", `lab_up`),
            Markup.button.callback("▼", `lab_down`)
          );
        }
        refetchButtons.unshift(labHeader);
      }

      refetchButtons.push(["🔙 regreso a materiales", "🔝 lista principal"]);

      const keyboard = isAdmin
        ? Markup.inlineKeyboard(refetchButtons)
        : Markup.keyboard(refetchButtons);

      try {
        await ctx.editMessageText(
          `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
          {
            reply_markup: keyboard,
          }
        );
      } catch {
        // If edit fails, just send new message
        await ctx.reply(
          `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
          isAdmin ? Markup.inlineKeyboard(refetchButtons).resize() : Markup.keyboard(refetchButtons).resize(),
        );
      }
      return;
      }

    // Handle callback queries for lecture reordering
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;

      // Skip if not a lecture reorder callback
      if (!data.startsWith("lecture_") && data !== "lab_up" && data !== "lab_down") {
        return;
      }

      // Acknowledge the callback query immediately
      await ctx.answerCallbackQuery();

      const user = ctx.state.dbUser;
      const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";

      if (!isAdminOrOwner) {
        return;
      }

      if (data === "lab_up" || data === "lab_down") {
        await ctx.answerCallbackQuery("ℹ️ Use individual lecture buttons to reorder");
        return;
      }

      // Extract lecture index from callback data: lecture_up_0, lecture_down_3, etc.
      const parts = data.split("_");
      const action = parts[1]; // "up" or "down"
      const index = parseInt(parts[2], 10);

      if (isNaN(index)) {
        await ctx.answerCallbackQuery("⚠️ Invalid lecture index");
        return;
      }

      const lectures = ctx.wizard.state.theoryLectures;
      if (index < 0 || index >= lectures.length) {
        await ctx.answerCallbackQuery("⚠️ Lecture not found");
        return;
      }

      const lecture = lectures[index];
      if (!lecture) {
        await ctx.answerCallbackQuery("⚠️ Lecture not found");
        return;
      }

      const classId = ctx.wizard.state.classId;

      if (action === "up") {
        // Move lecture up - swap position with previous
        if (lecture.position <= 0) {
          await ctx.answerCallbackQuery("🔝 Already at top");
          return;
        }

        const prevLecture = await Lecture.findOne({
          classId,
          position: lecture.position - 1,
        });
        if (!prevLecture) {
          await ctx.answerCallbackQuery("⚠️ Error finding previous lecture");
          return;
        }

        // Swap positions
        const temp = lecture.position;
        lecture.position = prevLecture.position;
        prevLecture.position = temp;
        await lecture.save();
        await prevLecture.save();

        await ctx.answerCallbackQuery("✅ Moved up");
      } else if (action === "down") {
        // Move lecture down - swap position with next
        const allLectures = await Lecture.find({ classId });
        const sortedLectures = allLectures.sort((a, b) => a.position - b.position);
        const lastLecture = sortedLectures[sortedLectures.length - 1];

        if (lastLecture && lecture.position >= lastLecture.position) {
          await ctx.answerCallbackQuery("🔝 Already at bottom");
          return;
        }

        const nextLecture = await Lecture.findOne({
          classId,
          position: lecture.position + 1,
        });
        if (!nextLecture) {
          await ctx.answerCallbackQuery("⚠️ Error finding next lecture");
          return;
        }

        // Swap positions
        const temp = lecture.position;
        lecture.position = nextLecture.position;
        nextLecture.position = temp;
        await lecture.save();
        await nextLecture.save();

        await ctx.answerCallbackQuery("✅ Moved down");
      }

      // Refresh the lecture display
      const selectedClass = await Class.findOne({
        _id: ctx.wizard.state.classId,
      });

      if (!selectedClass) {
        return;
      }

      const refetchLectures = await timeIt(
        "DB: Refresh Lectures",
        Lecture.find({ classId: selectedClass._id }).sort({ position: 1 }),
      );

      const refetchTheory = refetchLectures.filter((l) => l.category !== "lab");
      const refetchLab = refetchLectures.filter((l) => l.category === "lab");

      // Rebuild buttons with new positions
      const isAdmin = ctx.state.dbUser?.role === "admin" || ctx.state.dbUser?.role === "owner";
      const refetchButtons = refetchTheory.map((l, idx) => {
        const base = [l.title];
        if (isAdmin) {
          base.push(
            Markup.button.callback(`▲${idx}`, `lecture_up_${idx}`),
            Markup.button.callback(`▼${idx}`, `lecture_down_${idx}`)
          );
        }
        return base;
      });

      if (refetchLab.length > 0) {
        const labHeader = ["🔬 Lab Lectures"];
        if (isAdmin) {
          labHeader.push(
            Markup.button.callback("▲", `lab_up`),
            Markup.button.callback("▼", `lab_down`)
          );
        }
        refetchButtons.unshift(labHeader);
      }

      refetchButtons.push(["🔙 regreso a materiales", "🔝 lista principal"]);

      const keyboard = isAdmin
        ? Markup.inlineKeyboard(refetchButtons)
        : Markup.keyboard(refetchButtons);

      try {
        await ctx.editMessageText(
          `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
          {
            reply_markup: keyboard,
          }
        );
      } catch {
        // If edit fails, just send new message
        await ctx.reply(
          `📖 ${selectedClass.name}\n\nاختر محاضرة:`,
          isAdmin ? Markup.inlineKeyboard(refetchButtons).resize() : Markup.keyboard(refetchButtons).resize(),
        );
      }
      return;
    }

    const text = ctx.message?.text;
    if (isCancel(text)) {
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    if (text === "🔙 regreso a materiales") {
      return ctx.scene.enter("BROWSE_CLASSES_SCENE");
    }

    // Re-show the lectures keyboard when coming back from Lab folder
    if (text === "🔙 regreso a materiales") {
      const theoryButtons = ctx.wizard.state.theoryLectures.map((l) => [
        l.title,
      ]);
      if (ctx.wizard.state.labLectures.length > 0) {
        theoryButtons.unshift(["🔬 Lab Lectures"]);
      }
      theoryButtons.push(["🔙 regreso a materiales", "🔝 lista principal"]);

      await ctx.reply("📖 المحاضرات:", Markup.keyboard(theoryButtons).resize());
      return;
    }

    // Show Lab lectures folder
    if (
      text === "🔬 Lab Lectures" &&
      ctx.wizard.state.labLectures?.length > 0
    ) {
      const labButtons = ctx.wizard.state.labLectures.map((l) => [l.title]);
      labButtons.push(["🔙 regreso a materiales", "🔝 lista principal"]);

      await ctx.reply(
        "🔬 Lab Lectures:\n\nاختار محاضرة:",
        Markup.keyboard(labButtons).resize(),
      );
      return;
    }

    // Find and send the selected lecture
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
    } catch {
      // Ignore failure to delete status message
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