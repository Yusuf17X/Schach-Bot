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

    // Store for keyboard rebuilding
    ctx.wizard.state.isAdminOrOwner = isAdminOrOwner;

    function buildAdminKeyboard(lectures) {
      const rows = [];
      lectures.forEach((l, idx) => {
        rows.push([
          Markup.button.callback("▲", `lecture_up_${idx}`),
          Markup.button.callback(l.title, `lecture_select_${idx}`),
          Markup.button.callback("▼", `lecture_down_${idx}`),
        ]);
        rows.push([
          Markup.button.callback("✏️", `lecture_rename_${idx}`),
          Markup.button.callback("🗑️", `lecture_delete_${idx}`),
        ]);
      });
      rows.push([
        Markup.button.callback("🔙 العودة الى المواد", "back_to_classes"),
      ]);
      return Markup.inlineKeyboard(rows);
    }

    function buildUserKeyboard(lectures, labLectures) {
      const rows = lectures.map((l) => [l.title]);
      if (labLectures && labLectures.length > 0) {
        rows.unshift(["🔬 Lab Lectures"]);
      }
      rows.push(["🔙 العودة الى المواد", "🔝 القائمة الرئيسية"]);
      return Markup.keyboard(rows).resize();
    }

    ctx.wizard.state.buildAdminKeyboard = buildAdminKeyboard;
    ctx.wizard.state.buildUserKeyboard = buildUserKeyboard;

    // Build keyboard based on user role
    let keyboard;
    if (isAdminOrOwner) {
      keyboard = buildAdminKeyboard(theoryLectures);
    } else {
      keyboard = buildUserKeyboard(theoryLectures, labLectures);
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
      // Handle rename input for admins
      if (ctx.wizard.state.renamingIdx !== undefined) {
        const idx = ctx.wizard.state.renamingIdx;
        delete ctx.wizard.state.renamingIdx;

        const lectures = ctx.wizard.state.theoryLectures;
        const lecture = lectures[idx];
        if (!lecture) return ctx.reply("⚠️ محاضرة غير موجودة.");

        const newName = text.trim();
        if (!newName) return ctx.reply("⚠️ الاسم لا يمكن أن يكون فارغاً.");

        const oldName = lecture.title;
        await Lecture.updateOne({ _id: lecture._id }, { title: newName });
        lecture.title = newName;

        const selectedClassId = ctx.wizard.state.classId;
        const buildAdminKeyboard = ctx.wizard.state.buildAdminKeyboard;

        try {
          const className = (await Class.findOne({ _id: selectedClassId }))?.name || "";
          await ctx.reply(
            `✅ تم تغيير اسم "${oldName}" إلى "${newName}"`,
            buildAdminKeyboard(lectures)
          );
        } catch (e) {
          console.error("Failed to send updated keyboard:", e.message);
        }
        return;
      }

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
      return ctx.scene.leave();
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

      const selectedClassId = ctx.wizard.state.classId;
      const buildAdminKeyboard = ctx.wizard.state.buildAdminKeyboard;

      try {
        const className = (await Class.findOne({ _id: selectedClassId }))?.name || "";
        await ctx.editMessageText(
          `📖 ${className}\n\nاختر محاضرة:`,
          buildAdminKeyboard(lectures)
        );
      } catch (e) {
        console.error("editMessageText failed:", e.message);
      }
      return;
    }

    // Rename lecture - prompt
    if (data.startsWith("lecture_rename_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const lectures = ctx.wizard.state.theoryLectures;
      const lecture = lectures[idx];
      if (!lecture) return;

      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();

      ctx.wizard.state.renamingIdx = idx;
      await ctx.reply(`✏️ اكتب الاسم الجديد لمحاضرة "${lecture.title}":`);
      return;
    }

    // Delete lecture
    if (data.startsWith("lecture_delete_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const lectures = ctx.wizard.state.theoryLectures;
      const lecture = lectures[idx];
      if (!lecture) return;

      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();

      await Lecture.deleteOne({ _id: lecture._id });
      lectures.splice(idx, 1);

      // Reassign ALL positions
      for (let i = 0; i < lectures.length; i++) {
        await Lecture.updateOne({ _id: lectures[i]._id }, { position: i });
        lectures[i].position = i;
      }

      const selectedClassId = ctx.wizard.state.classId;
      const buildAdminKeyboard = ctx.wizard.state.buildAdminKeyboard;

      try {
        const className = (await Class.findOne({ _id: selectedClassId }))?.name || "";
        await ctx.editMessageText(
          `📖 ${className}\n\nاختر محاضرة:`,
          buildAdminKeyboard(lectures)
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
    const archives = await timeIt("DB: Fetch Archives", Archive.find().sort({ position: 1 }));
    if (archives.length === 0) {
      await ctx.reply("هذا القسم فارغ حاليا....", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.wizard.state.archives = archives;
    const isAdminOrOwner = ctx.state.dbUser?.role === "admin" || ctx.state.dbUser?.role === "owner";
    ctx.wizard.state.isAdminOrOwner = isAdminOrOwner;

    function buildAdminKeyboard(items) {
      const rows = [];
      items.forEach((a, idx) => {
        rows.push([
          Markup.button.callback("▲", `archive_up_${idx}`),
          Markup.button.callback(a.name, `archive_select_${idx}`),
          Markup.button.callback("▼", `archive_down_${idx}`),
        ]);
        rows.push([
          Markup.button.callback("✏️", `archive_rename_${idx}`),
          Markup.button.callback("🗑️", `archive_delete_${idx}`),
        ]);
      });
      rows.push([Markup.button.callback("🔝 القائمة الرئيسية", "archive_main_menu")]);
      return Markup.inlineKeyboard(rows);
    }

    function buildUserKeyboard(items) {
      const rows = items.map((a) => [a.name]);
      rows.push(["🔝 القائمة الرئيسية"]);
      return Markup.keyboard(rows).resize();
    }

    ctx.wizard.state.buildAdminKeyboard = buildAdminKeyboard;
    ctx.wizard.state.buildUserKeyboard = buildUserKeyboard;

    const keyboard = isAdminOrOwner ? buildAdminKeyboard(archives) : buildUserKeyboard(archives);

    await ctx.reply("📦 اختر أرشيف:", keyboard);
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Handle text messages (regular users + rename input)
    const text = ctx.message?.text;
    if (text) {
      // Handle rename input for admins
      if (ctx.wizard.state.renamingIdx !== undefined) {
        const idx = ctx.wizard.state.renamingIdx;
        delete ctx.wizard.state.renamingIdx;

        const archives = ctx.wizard.state.archives;
        const archive = archives[idx];
        if (!archive) return ctx.reply("⚠️ أرشيف غير موجود.");

        const newName = text.trim();
        if (!newName) return ctx.reply("⚠️ الاسم لا يمكن أن يكون فارغاً.");

        const oldName = archive.name;
        await Archive.updateOne({ _id: archive._id }, { name: newName });
        archive.name = newName;

        const buildAdminKeyboard = ctx.wizard.state.buildAdminKeyboard;
        await ctx.reply(
          `✅ تم تغيير اسم "${oldName}" إلى "${newName}"`,
          buildAdminKeyboard(archives)
        );
        return;
      }

      if (isCancel(text) || text === "🔝 القائمة الرئيسية") {
        await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
        return ctx.scene.leave();
      }

      // Regular user - find archive by name and send files
      const archives = ctx.wizard.state.archives;
      const archive = archives.find((a) => a.name === text);
      if (!archive) return ctx.reply("⚠️ اختر أرشيف صحيح من الازرار.");

      const files = await ArchiveFile.find({ archiveId: archive._id });
      if (files.length === 0) {
        await ctx.reply("⚠️ هذا الأرشيف فارغ.");
        return;
      }

      const statusMsg = await ctx.reply(`⏳ إرسال ${files.length} ملفات من ${archive.name}...`);
      for (const file of files) {
        try {
          await ctx.telegram.sendDocument(ctx.chat.id, file.fileId);
        } catch {
          await ctx.telegram.sendPhoto(ctx.chat.id, file.fileId).catch(() => {});
        }
      }
      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply("✅ تم إرسال جميع الملفات.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // Handle inline keyboard callback queries (admins/owners)
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;

    // Main menu
    if (data === "archive_main_menu") {
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // Select archive - send files
    if (data.startsWith("archive_select_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const archives = ctx.wizard.state.archives;
      const archive = archives[idx];
      if (!archive) return;
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();

      const files = await ArchiveFile.find({ archiveId: archive._id });
      if (files.length === 0) {
        await ctx.reply("⚠️ هذا الأرشيف فارغ.");
        return;
      }

      const statusMsg = await ctx.reply(`⏳ إرسال ${files.length} ملفات من ${archive.name}...`);
      for (const file of files) {
        try {
          await ctx.telegram.sendDocument(ctx.chat.id, file.fileId);
        } catch {
          await ctx.telegram.sendPhoto(ctx.chat.id, file.fileId).catch(() => {});
        }
      }
      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply("✅ تم إرسال جميع الملفات.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // Reorder up/down
    if (data.startsWith("archive_up_") || data.startsWith("archive_down_")) {
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      const isUp = data.startsWith("archive_up_");
      const idx = parseInt(data.split("_")[2], 10);
      const archives = ctx.wizard.state.archives;
      if (!archives[idx]) return;

      const swapIdx = isUp ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= archives.length) {
        if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery({ text: "⚠️ لا يمكن التحرك", show_alert: true });
        return;
      }

      const temp = archives[idx];
      archives[idx] = archives[swapIdx];
      archives[swapIdx] = temp;

      for (let i = 0; i < archives.length; i++) {
        await Archive.updateOne({ _id: archives[i]._id }, { position: i });
        archives[i].position = i;
      }

      try {
        await ctx.editMessageText("📦 اختر أرشيف:", ctx.wizard.state.buildAdminKeyboard(archives));
      } catch (e) {
        console.error("editMessageText failed:", e.message);
      }
      return;
    }

    // Rename archive - prompt
    if (data.startsWith("archive_rename_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const archives = ctx.wizard.state.archives;
      const archive = archives[idx];
      if (!archive) return;

      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      ctx.wizard.state.renamingIdx = idx;
      await ctx.reply(`✏️ اكتب الاسم الجديد لأرشيف "${archive.name}":`);
      return;
    }

    // Delete archive
    if (data.startsWith("archive_delete_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const archives = ctx.wizard.state.archives;
      const archive = archives[idx];
      if (!archive) return;

      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();

      await ArchiveFile.deleteMany({ archiveId: archive._id });
      await Archive.deleteOne({ _id: archive._id });
      archives.splice(idx, 1);

      for (let i = 0; i < archives.length; i++) {
        await Archive.updateOne({ _id: archives[i]._id }, { position: i });
        archives[i].position = i;
      }

      try {
        await ctx.editMessageText("📦 اختر أرشيف:", ctx.wizard.state.buildAdminKeyboard(archives));
      } catch (e) {
        console.error("editMessageText failed:", e.message);
      }
      return;
    }
  },
);

const viewCreativeWizard = new Scenes.WizardScene(
  "VIEW_CREATIVE_SCENE",
  async (ctx) => {
    const creatives = await timeIt("DB: Fetch Creatives", Creative.find().sort({ position: 1 }));
    if (creatives.length === 0) {
      await ctx.reply("هذا القسم فارغ حاليا....", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.wizard.state.creatives = creatives;
    const isAdminOrOwner = ctx.state.dbUser?.role === "admin" || ctx.state.dbUser?.role === "owner";
    ctx.wizard.state.isAdminOrOwner = isAdminOrOwner;

    function buildAdminKeyboard(items) {
      const rows = [];
      items.forEach((c, idx) => {
        rows.push([
          Markup.button.callback("▲", `creative_up_${idx}`),
          Markup.button.callback(c.name, `creative_select_${idx}`),
          Markup.button.callback("▼", `creative_down_${idx}`),
        ]);
        rows.push([
          Markup.button.callback("✏️", `creative_rename_${idx}`),
          Markup.button.callback("🗑️", `creative_delete_${idx}`),
        ]);
      });
      rows.push([Markup.button.callback("🔝 القائمة الرئيسية", "creative_main_menu")]);
      return Markup.inlineKeyboard(rows);
    }

    function buildUserKeyboard(items) {
      const rows = items.map((c) => [c.name]);
      rows.push(["🔝 القائمة الرئيسية"]);
      return Markup.keyboard(rows).resize();
    }

    ctx.wizard.state.buildAdminKeyboard = buildAdminKeyboard;
    ctx.wizard.state.buildUserKeyboard = buildUserKeyboard;

    const keyboard = isAdminOrOwner ? buildAdminKeyboard(creatives) : buildUserKeyboard(creatives);

    await ctx.reply("🎨 اختر زر:", keyboard);
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Handle text messages (regular users + rename input)
    const text = ctx.message?.text;
    if (text) {
      // Handle rename input for admins
      if (ctx.wizard.state.renamingIdx !== undefined) {
        const idx = ctx.wizard.state.renamingIdx;
        delete ctx.wizard.state.renamingIdx;

        const creatives = ctx.wizard.state.creatives;
        const creative = creatives[idx];
        if (!creative) return ctx.reply("⚠️ أداة غير موجودة.");

        const newName = text.trim();
        if (!newName) return ctx.reply("⚠️ الاسم لا يمكن أن يكون فارغاً.");

        const oldName = creative.name;
        await Creative.updateOne({ _id: creative._id }, { name: newName });
        creative.name = newName;

        const buildAdminKeyboard = ctx.wizard.state.buildAdminKeyboard;
        await ctx.reply(
          `✅ تم تغيير اسم "${oldName}" إلى "${newName}"`,
          buildAdminKeyboard(creatives)
        );
        return;
      }

      if (isCancel(text) || text === "🔝 القائمة الرئيسية") {
        await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
        return ctx.scene.leave();
      }

      // Regular user - find creative by name and show content
      const creatives = ctx.wizard.state.creatives;
      const creative = creatives.find((c) => c.name === text);
      if (!creative) return ctx.reply("⚠️ اختر زر من الازرار الموجودة.");

      try {
        await ctx.telegram.copyMessage(ctx.chat.id, process.env.CHANNEL_ID, creative.channelMsgId);
      } catch (error) {
        console.error("Failed to copy message:", error);
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
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      }
      await ctx.reply("✅ تم إرسال جميع الملفات.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // Handle inline keyboard callback queries (admins/owners)
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;

    // Main menu
    if (data === "creative_main_menu") {
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      await ctx.reply("🔝 القائمة الرئيسية", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // Select creative - show content + files
    if (data.startsWith("creative_select_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const creatives = ctx.wizard.state.creatives;
      const creative = creatives[idx];
      if (!creative) return;
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();

      try {
        await ctx.telegram.copyMessage(ctx.chat.id, process.env.CHANNEL_ID, creative.channelMsgId);
      } catch (error) {
        console.error("Failed to copy message:", error);
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
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      }
      await ctx.reply("✅ تم إرسال جميع الملفات.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    // Reorder up/down
    if (data.startsWith("creative_up_") || data.startsWith("creative_down_")) {
      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      const isUp = data.startsWith("creative_up_");
      const idx = parseInt(data.split("_")[2], 10);
      const creatives = ctx.wizard.state.creatives;
      if (!creatives[idx]) return;

      const swapIdx = isUp ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= creatives.length) {
        if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery({ text: "⚠️ لا يمكن التحرك", show_alert: true });
        return;
      }

      const temp = creatives[idx];
      creatives[idx] = creatives[swapIdx];
      creatives[swapIdx] = temp;

      for (let i = 0; i < creatives.length; i++) {
        await Creative.updateOne({ _id: creatives[i]._id }, { position: i });
        creatives[i].position = i;
      }

      try {
        await ctx.editMessageText("🎨 اختر زر:", ctx.wizard.state.buildAdminKeyboard(creatives));
      } catch (e) {
        console.error("editMessageText failed:", e.message);
      }
      return;
    }

    // Rename creative - prompt
    if (data.startsWith("creative_rename_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const creatives = ctx.wizard.state.creatives;
      const creative = creatives[idx];
      if (!creative) return;

      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();
      ctx.wizard.state.renamingIdx = idx;
      await ctx.reply(`✏️ اكتب الاسم الجديد لأداة "${creative.name}":`);
      return;
    }

    // Delete creative
    if (data.startsWith("creative_delete_")) {
      const idx = parseInt(data.split("_")[2], 10);
      const creatives = ctx.wizard.state.creatives;
      const creative = creatives[idx];
      if (!creative) return;

      if (typeof ctx.answerCbQuery === "function") await ctx.answerCbQuery();

      // Delete channel message
      try {
        await ctx.telegram.deleteMessage(process.env.CHANNEL_ID, creative.channelMsgId);
      } catch {}

      await CreativeFile.deleteMany({ creativeId: creative._id });
      await Creative.deleteOne({ _id: creative._id });
      creatives.splice(idx, 1);

      for (let i = 0; i < creatives.length; i++) {
        await Creative.updateOne({ _id: creatives[i]._id }, { position: i });
        creatives[i].position = i;
      }

      try {
        await ctx.editMessageText("🎨 اختر زر:", ctx.wizard.state.buildAdminKeyboard(creatives));
      } catch (e) {
        console.error("editMessageText failed:", e.message);
      }
      return;
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
