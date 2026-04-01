const { Scenes, Markup } = require("telegraf");
const prisma = require("./models");
const {
  timeIt,
  isCancel,
  mainMenuKeyboard,
  adminPanelKeyboard,
  queueGroupNotification,
} = require("./utils");

const addStageWizard = new Scenes.WizardScene(
  "ADD_STAGE_SCENE",
  (ctx) => {
    ctx.reply(
      "✍️ Type the name of the new Stage:",
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx))); // FIX: Executed the function

    await timeIt("DB: Create Stage", prisma.stage.create({ data: { name: ctx.message.text } }));
    ctx.reply(
      `✅ Stage "${ctx.message.text}" created!`,
      adminPanelKeyboard(ctx),
    );
    return ctx.scene.leave();
  },
);

const addClassWizard = new Scenes.WizardScene(
  "ADD_CLASS_SCENE",
  async (ctx) => {
    const stages = await timeIt("DB: Fetch Stages", prisma.stage.findMany());
    const buttons = stages.map((s) => [s.name]);
    buttons.push(["❌ Cancel"]);
    ctx.reply(
      "Select the Stage for this class:",
      Markup.keyboard(buttons).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return ctx.reply("Select a valid stage from the keyboard.");

    ctx.wizard.state.stageId = stage.id;
    ctx.reply(
      "✍️ Type the name of the new Class:",
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    await timeIt(
      "DB: Create Class",
      prisma.class.create({
        data: {
          name: ctx.message.text,
          stageId: ctx.wizard.state.stageId,
        },
      }),
    );
    ctx.reply(`✅ Class created!`, adminPanelKeyboard(ctx));
    return ctx.scene.leave();
  },
);

const addLectureWizard = new Scenes.WizardScene(
  "ADD_LECTURE_SCENE",
  // Step 0: The Routing Step
  async (ctx) => {
    const user = ctx.state.dbUser;

    if (user.role === "admin") {
      const stage = await prisma.stage.findUnique({ where: { id: user.managedStageId } });
      if (!stage)
        return ctx.scene.leave(
          ctx.reply(
            "❌ Error: No stage assigned to you.",
            adminPanelKeyboard(ctx),
          ),
        );

      ctx.wizard.state.stageId = stage.id;
      const classes = await prisma.class.findMany({ where: { stageId: stage.id } });

      ctx.reply(
        `✅ Adding to **${stage.name}**.\n\nSelect the Class:`,
        Markup.keyboard([
          ...classes.map((c) => [c.name]),
          ["❌ Cancel"],
        ]).resize(),
      );

      ctx.wizard.selectStep(2);
      return;
    } else {
      const stages = await prisma.stage.findMany();
      ctx.reply(
        "Select the Stage:",
        Markup.keyboard([
          ...stages.map((s) => [s.name]),
          ["❌ Cancel"],
        ]).resize(),
      );
      return ctx.wizard.next();
    }
  },
  // Step 1: Owner Only - Process Stage Selection
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return ctx.reply("⚠️ Please select a valid stage.");

    ctx.wizard.state.stageId = stage.id;
    const classes = await prisma.class.findMany({ where: { stageId: stage.id } });

    ctx.reply(
      "Select the Class:",
      Markup.keyboard([
        ...classes.map((c) => [c.name]),
        ["❌ Cancel"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  // Step 2: Both Admin and Owner end up here to select the Class
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    const selectedClass = await prisma.class.findFirst({
      where: { name: ctx.message.text, stageId: ctx.wizard.state.stageId },
    });

    if (!selectedClass)
      return ctx.reply("⚠️ Please select a valid class from the keyboard.");

    ctx.wizard.state.classId = selectedClass.id;

    // Ask for the Category instead of immediately asking for files!
    ctx.reply(
      "Is this a Theory or Lab lecture?",
      Markup.keyboard([["Theory", "Lab"], ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  //Step 3: Handle Category Selection & Initialize File Queue
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    if (text !== "Theory" && text !== "Lab") {
      return ctx.reply("⚠️ Please select 'Theory' or 'Lab' from the keyboard.");
    }

    // Save the category (make it lowercase to match your browseClasses logic)
    ctx.wizard.state.category = text.toLowerCase();
    ctx.wizard.state.files = [];

    ctx.reply(
      `📎 Send your **${text}** lecture files (PDF/PPTX). Click '✅ Done' when finished.`,
      Markup.keyboard([["✅ Done"], ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  // Step 4: Handle File Queue Collection
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    // 1. Collect files into the queue
    if (ctx.message?.document) {
      ctx.wizard.state.files.push(ctx.message);
      const fileName = ctx.message.document.file_name || "Unknown File";
      ctx.reply(`📥 Added to queue: ${fileName}`);
      return;
    }

    // 2. When they click Done, prepare the naming loop!
    if (text === "✅ Done") {
      if (ctx.wizard.state.files.length === 0) {
        return ctx.reply(
          "⚠️ You haven't sent any files yet! Send a file or click Cancel.",
        );
      }

      // Sort files to keep them in the order they were sent
      ctx.wizard.state.files = ctx.wizard.state.files.sort(
        (a, b) => a.message_id - b.message_id,
      );

      // Setup the loop variables
      ctx.wizard.state.currentIndex = 0;
      ctx.wizard.state.uploadedNames = [];

      const firstFile = ctx.wizard.state.files[0].document;
      const originalName = firstFile.file_name || "Unknown";

      // Ask for the first file's name
      ctx.reply(
        `📚 We have ${ctx.wizard.state.files.length} files to process.\n\n` +
          `1️⃣ First file: ${originalName}\n` +
          `✍️ Type the button name for this lecture (or type 'skip' to use the original name):`,
        Markup.removeKeyboard(), // Hide the Done/Cancel keyboard so they type text
      );

      return ctx.wizard.next();
    }

    ctx.reply("⚠️ Please send a PDF/PPTX document, or click '✅ Done'.");
  },
  // Step 5: Ask for names one by one and Save
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    if (!text) {
      return ctx.reply("⚠️ Please type a text name or 'skip'.");
    }

    const currentIndex = ctx.wizard.state.currentIndex;
    const currentMsg = ctx.wizard.state.files[currentIndex];
    const doc = currentMsg.document;
    const fileName = doc.file_name || "Unknown";

    // Calculate original default title
    const defaultTitle =
      fileName.lastIndexOf(".") !== -1
        ? fileName.substring(0, fileName.lastIndexOf("."))
        : fileName;

    // Determine the final title (Custom vs Default)
    const finalTitle =
      text.toLowerCase() === "skip" || text === "تخطي" ? defaultTitle : text;

    ctx.reply(`⏳ Saving "${finalTitle}"...`);

    try {
      const channelMsg = await timeIt(
        `TG: Send ${finalTitle} to Channel`,
        ctx.telegram.sendDocument(process.env.CHANNEL_ID, doc.file_id, {
          caption: `Lecture: ${finalTitle}`,
        }),
      );

      await timeIt(
        `DB: Save ${finalTitle}`,
        prisma.lecture.create({
          data: {
            title: finalTitle,
            classId: ctx.wizard.state.classId,
            fileId: channelMsg.document.file_id,
            fileType: fileName.toLowerCase().endsWith(".pdf") ? "pdf" : "pptx",
            channelMsgId: channelMsg.message_id,
            category: ctx.wizard.state.category,
          },
        }),
      );

      ctx.reply(`✅ Saved: ${finalTitle}`);
      ctx.wizard.state.uploadedNames.push(finalTitle); // Add custom name to notifications array
    } catch (error) {
      console.error(error);
      ctx.reply(`❌ Error saving: ${fileName}`);
    }
    // ---------------------------------

    // Move to the next file in the queue
    ctx.wizard.state.currentIndex++;

    // Check if there are more files to name
    if (ctx.wizard.state.currentIndex < ctx.wizard.state.files.length) {
      const nextFile =
        ctx.wizard.state.files[ctx.wizard.state.currentIndex].document;
      const nextOriginalName = nextFile.file_name || "Unknown";

      ctx.reply(
        `\n➡️ Next file: ${nextOriginalName}\n` +
          `✍️ Type the name (or 'skip'):`,
      );
      return; // return WITHOUT ctx.wizard.next() keeps them in Step 5 for the next message!
    } else {
      // All files are named and saved! Send Notifications.
      ctx.reply("✅ All uploads and naming finished.", adminPanelKeyboard(ctx));

      const stageObj = await prisma.stage.findUnique({ where: { id: ctx.wizard.state.stageId } });
      const classObj = await prisma.class.findUnique({ where: { id: ctx.wizard.state.classId } });

      if (stageObj && stageObj.telegramGroupId) {
        queueGroupNotification(ctx, stageObj, {
          className: classObj.name,
          fileNames: ctx.wizard.state.uploadedNames,
          category: ctx.wizard.state.category,
        });
      }

      return ctx.scene.leave();
    }
  },
);

// --- DELETE WIZARDS ---

const delStageWizard = new Scenes.WizardScene(
  "DEL_STAGE_SCENE",
  async (ctx) => {
    const stages = await timeIt("DB: Fetch Stages", prisma.stage.findMany());
    if (stages.length === 0)
      return ctx.scene.leave(
        ctx.reply("No stages to delete.", adminPanelKeyboard(ctx)),
      );

    ctx.reply(
      "⚠️ Select a Stage to PERMANENTLY delete (this deletes ALL classes and lectures inside it):",
      Markup.keyboard([...stages.map((s) => [s.name]), ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return ctx.reply("Select a valid stage.");

    ctx.reply("⏳ Deleting stage and cleaning up files...");

    const classes = await prisma.class.findMany({ where: { stageId: stage.id } });
    for (const c of classes) {
      const lectures = await prisma.lecture.findMany({ where: { classId: c.id } });
      for (const l of lectures) {
        try {
          await ctx.telegram.deleteMessage(
            process.env.CHANNEL_ID,
            l.channelMsgId,
          );
        } catch (e) {
          console.log(`Failed to delete msg ${l.channelMsgId} from channel.`); // FIX: Added logging
        }
      }
      await prisma.lecture.deleteMany({ where: { classId: c.id } });
    }
    await prisma.class.deleteMany({ where: { stageId: stage.id } });
    await prisma.stage.delete({ where: { id: stage.id } });

    ctx.reply(
      `✅ Stage "${stage.name}" and all its contents completely deleted.`,
      adminPanelKeyboard(ctx),
    );
    return ctx.scene.leave();
  },
);

const delClassWizard = new Scenes.WizardScene(
  "DEL_CLASS_SCENE",
  async (ctx) => {
    const stages = await timeIt("DB: Fetch Stages", prisma.stage.findMany());
    ctx.reply(
      "Select the Stage containing the Class to delete:",
      Markup.keyboard([...stages.map((s) => [s.name]), ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return;

    const classes = await timeIt(
      "DB: Fetch Classes",
      prisma.class.findMany({ where: { stageId: stage.id } }),
    );
    if (classes.length === 0)
      return ctx.scene.leave(
        ctx.reply("No classes here.", adminPanelKeyboard(ctx)),
      );

    ctx.reply(
      "⚠️ Select the Class to PERMANENTLY delete (removes all its lectures):",
      Markup.keyboard([
        ...classes.map((c) => [c.name]),
        ["❌ Cancel"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const selectedClass = await prisma.class.findFirst({ where: { name: ctx.message.text } });
    if (!selectedClass) return;

    ctx.reply("⏳ Deleting class and cleaning up files...");

    const lectures = await prisma.lecture.findMany({ where: { classId: selectedClass.id } });
    for (const l of lectures) {
      try {
        await ctx.telegram.deleteMessage(
          process.env.CHANNEL_ID,
          l.channelMsgId,
        );
      } catch (e) {
        console.log(`Failed to delete msg ${l.channelMsgId} from channel.`);
      }
    }
    await prisma.lecture.deleteMany({ where: { classId: selectedClass.id } });
    await prisma.class.delete({ where: { id: selectedClass.id } });

    ctx.reply(
      `✅ Class "${selectedClass.name}" and all its files deleted.`,
      adminPanelKeyboard(ctx),
    );
    return ctx.scene.leave();
  },
);

const delLectureWizard = new Scenes.WizardScene(
  "DEL_LECTURE_SCENE",
  async (ctx) => {
    const stages = await timeIt("DB: Fetch Stages", prisma.stage.findMany());
    ctx.reply(
      "Select the Stage:",
      Markup.keyboard([...stages.map((s) => [s.name]), ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return;

    const classes = await timeIt(
      "DB: Fetch Classes",
      prisma.class.findMany({ where: { stageId: stage.id } }),
    );
    ctx.reply(
      "Select the Class:",
      Markup.keyboard([
        ...classes.map((c) => [c.name]),
        ["❌ Cancel"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const selectedClass = await prisma.class.findFirst({ where: { name: ctx.message.text } });
    if (!selectedClass) return;

    const lectures = await timeIt(
      "DB: Fetch Lectures",
      prisma.lecture.findMany({ where: { classId: selectedClass.id } }),
    );
    if (lectures.length === 0)
      return ctx.scene.leave(
        ctx.reply("No lectures here.", adminPanelKeyboard(ctx)),
      );

    ctx.reply(
      "❌ Select the Lecture to delete:",
      Markup.keyboard([
        ...lectures.map((l) => [l.title]),
        ["❌ Cancel"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const lecture = await prisma.lecture.findFirst({ where: { title: ctx.message.text } });
    if (!lecture) return;

    try {
      await ctx.telegram.deleteMessage(
        process.env.CHANNEL_ID,
        lecture.channelMsgId,
      );
    } catch (e) {
      console.log(`Failed to delete msg ${lecture.channelMsgId} from channel.`);
    }
    await prisma.lecture.delete({ where: { id: lecture.id } });

    ctx.reply(`✅ Lecture deleted.`, adminPanelKeyboard(ctx));
    return ctx.scene.leave();
  },
);

// --- BROADCAST WIZARD ---

const broadcastWizard = new Scenes.WizardScene(
  "BROADCAST_SCENE",
  (ctx) => {
    ctx.reply(
      "📢 Type the message you want to broadcast to ALL users:",
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(
        ctx.reply("Broadcast cancelled.", adminPanelKeyboard(ctx)),
      );

    const users = await prisma.user.findMany();
    let sent = 0;
    ctx.reply(`⏳ Broadcasting to ${users.length} users...`);

    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user.chatId, `${ctx.message.text}`);
        sent++;
      } catch (err) {
        // User blocked bot
      }
    }
    ctx.reply(
      `✅ Broadcast finished. Reached ${sent}/${users.length} users.`,
      adminPanelKeyboard(ctx),
    );
    return ctx.scene.leave();
  },
);

// --- ADD ARCHIVE WIZARD ---
const addArchiveWizard = new Scenes.WizardScene(
  "ADD_ARCHIVE_SCENE",
  (ctx) => {
    ctx.reply(
      "📦 Type the name of the new Archive category:",
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    try {
      const archive = await timeIt(
        "DB: Create Archive",
        prisma.archive.create({ data: { name: ctx.message.text } }),
      );
      ctx.wizard.state.archiveId = archive.id;
      ctx.wizard.state.files = [];

      ctx.reply(
        `✅ Archive "${archive.name}" created.\n\n📎 Send all files for this archive, then click '✅ Done'.`,
        Markup.keyboard([["✅ Done"], ["❌ Cancel"]]).resize(),
      );
      return ctx.wizard.next();
    } catch (e) {
      return ctx.reply(
        "❌ Error: Archive name might already exist. Try another name or click Cancel.",
      );
    }
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    if (ctx.message?.document || ctx.message?.photo || ctx.message?.video) {
      ctx.wizard.state.files.push(ctx.message);
      ctx.reply(`📥 Added to archive queue.`);
      return;
    }

    if (text === "✅ Done") {
      if (ctx.wizard.state.files.length === 0)
        return ctx.reply("⚠️ Send files first!");

      const statusMsg = await ctx.reply(
        `⏳ Saving ${ctx.wizard.state.files.length} archive files...`,
        Markup.removeKeyboard(),
      );

      const sortedFiles = ctx.wizard.state.files.sort(
        (a, b) => a.message_id - b.message_id,
      );

      for (const msg of sortedFiles) {
        let fileId, title;
        if (msg.document) {
          fileId = msg.document.file_id;
          title = msg.document.file_name || "Document";
        } else if (msg.photo) {
          fileId = msg.photo[msg.photo.length - 1].file_id;
          title = "Photo";
        } else if (msg.video) {
          fileId = msg.video.file_id;
          title = "Video";
        }

        try {
          const channelMsg = await ctx.telegram.sendCopy(
            process.env.CHANNEL_ID,
            msg,
          );
          await prisma.archiveFile.create({
            data: {
              archiveId: ctx.wizard.state.archiveId,
              fileId: fileId,
              title: title,
              channelMsgId: channelMsg.message_id,
            },
          });
        } catch (error) {
          console.error("Archive Save Error", error);
        }
      }

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}
      ctx.reply("✅ Archive upload finished.", adminPanelKeyboard(ctx));

      return ctx.scene.leave();
    }
    ctx.reply("⚠️ Please send a file or click '✅ Done'.");
  },
);

// --- ADD CREATIVE WIZARD ---
const addCreativeWizard = new Scenes.WizardScene(
  "ADD_CREATIVE_SCENE",
  (ctx) => {
    ctx.reply(
      "🎨 Type the title of the Creative topic (e.g., 'Good Presentation'):",
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    ctx.wizard.state.creativeName = ctx.message.text;

    ctx.reply("✍️ Now, send the text message/description for this topic:");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    try {
      const channelMsg = await ctx.telegram.copyMessage(
        process.env.CHANNEL_ID,
        ctx.chat.id,
        ctx.message.message_id,
      );

      const creative = await timeIt(
        "DB: Create Creative",
        prisma.creative.create({
          data: {
            name: ctx.wizard.state.creativeName,
            text: ctx.message.text,
            channelMsgId: channelMsg.message_id,
          },
        }),
      );

      ctx.wizard.state.creativeId = creative.id;
      ctx.wizard.state.files = [];

      ctx.reply(
        "✅ Text saved.\n\n📎 Now send any attached files/images for this topic, then click '✅ Done'.",
        Markup.keyboard([["✅ Done"], ["❌ Cancel"]]).resize(),
      );
      return ctx.wizard.next();
    } catch (e) {
      console.error("Creative Save Error", e);
      return ctx.reply("❌ Error saving text. Try again or Cancel.");
    }
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (isCancel(text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    if (ctx.message?.document || ctx.message?.photo || ctx.message?.video) {
      ctx.wizard.state.files.push(ctx.message);
      ctx.reply(`📥 Added to creative queue.`);
      return;
    }

    if (text === "✅ Done") {
      ctx.reply(
        `⏳ Saving ${ctx.wizard.state.files.length} creative files...`,
        Markup.removeKeyboard(),
      );
      const sortedFiles = ctx.wizard.state.files.sort(
        (a, b) => a.message_id - b.message_id,
      );

      for (const msg of sortedFiles) {
        let fileId, title;
        if (msg.document) {
          fileId = msg.document.file_id;
          title = msg.document.file_name || "Document";
        } else if (msg.photo) {
          fileId = msg.photo[msg.photo.length - 1].file_id;
          title = "Photo";
        } else if (msg.video) {
          fileId = msg.video.file_id;
          title = "Video";
        }

        try {
          const channelMsg = await ctx.telegram.sendCopy(
            process.env.CHANNEL_ID,
            msg,
          );
          await prisma.creativeFile.create({
            data: {
              creativeId: ctx.wizard.state.creativeId,
              fileId: fileId,
              title: title,
              channelMsgId: channelMsg.message_id,
            },
          });
        } catch (error) {}
      }
      ctx.reply("✅ Creative topic fully saved.", adminPanelKeyboard(ctx));
      return ctx.scene.leave();
    }
    ctx.reply("⚠️ Please send a file or click '✅ Done'.");
  },
);

// --- DELETE ARCHIVE WIZARD ---
const delArchiveWizard = new Scenes.WizardScene(
  "DEL_ARCHIVE_SCENE",
  async (ctx) => {
    const archives = await timeIt("DB: Fetch Archives", prisma.archive.findMany());
    if (archives.length === 0)
      return ctx.scene.leave(
        ctx.reply("No archives to delete.", adminPanelKeyboard(ctx)),
      );

    ctx.reply(
      "⚠️ Select an Archive to PERMANENTLY delete (this deletes all its files):",
      Markup.keyboard([
        ...archives.map((a) => [a.name]),
        ["❌ Cancel"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const archive = await prisma.archive.findFirst({ where: { name: ctx.message.text } });
    if (!archive) return ctx.reply("Select a valid archive.");

    const statusMsg = await ctx.reply(
      "⏳ Deleting archive and cleaning up files...",
    );

    const files = await prisma.archiveFile.findMany({ where: { archiveId: archive.id } });
    for (const f of files) {
      try {
        await ctx.telegram.deleteMessage(
          process.env.CHANNEL_ID,
          f.channelMsgId,
        );
      } catch (e) {}
    }
    await prisma.archiveFile.deleteMany({ where: { archiveId: archive.id } });
    await prisma.archive.delete({ where: { id: archive.id } });

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (e) {}
    ctx.reply(
      `✅ Archive "${archive.name}" and all its files deleted.`,
      adminPanelKeyboard(ctx),
    );

    return ctx.scene.leave();
  },
);

// --- DELETE CREATIVE WIZARD ---
const delCreativeWizard = new Scenes.WizardScene(
  "DEL_CREATIVE_SCENE",
  async (ctx) => {
    const creatives = await timeIt("DB: Fetch Creatives", prisma.creative.findMany());
    if (creatives.length === 0)
      return ctx.scene.leave(
        ctx.reply("No creative topics to delete.", adminPanelKeyboard(ctx)),
      );

    ctx.reply(
      "⚠️ Select a Creative topic to PERMANENTLY delete (this deletes text and files):",
      Markup.keyboard([
        ...creatives.map((c) => [c.name]),
        ["❌ Cancel"],
      ]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));
    const creative = await prisma.creative.findFirst({ where: { name: ctx.message.text } });
    if (!creative) return ctx.reply("Select a valid creative topic.");

    ctx.reply("⏳ Deleting creative topic and cleaning up files...");

    try {
      await ctx.telegram.deleteMessage(
        process.env.CHANNEL_ID,
        creative.channelMsgId,
      );
    } catch (e) {}

    const files = await prisma.creativeFile.findMany({ where: { creativeId: creative.id } });
    for (const f of files) {
      try {
        await ctx.telegram.deleteMessage(
          process.env.CHANNEL_ID,
          f.channelMsgId,
        );
      } catch (e) {}
    }
    await prisma.creativeFile.deleteMany({ where: { creativeId: creative.id } });
    await prisma.creative.delete({ where: { id: creative.id } });

    ctx.reply(
      `✅ Creative topic "${creative.name}" and all its files deleted.`,
      adminPanelKeyboard(ctx),
    );
    return ctx.scene.leave();
  },
);

const promoteAdminWizard = new Scenes.WizardScene(
  "PROMOTE_ADMIN_SCENE",
  (ctx) => {
    ctx.reply(
      "👑 **Promote Stage Admin**\n\nPlease send the Telegram Chat ID of the user you want to promote.\n*(They can get their ID by messaging @userinfobot)*",
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    const targetUserId = parseInt(ctx.message.text);
    if (isNaN(targetUserId))
      return ctx.reply("⚠️ Please send a valid numeric ID.");

    const targetUser = await prisma.user.findFirst({ where: { chatId: targetUserId } });
    if (!targetUser)
      return ctx.reply(
        "❌ User not found in database. They must start the bot first.",
      );

    ctx.wizard.state.targetUserId = targetUser.id; // FIX: Saved state properly

    const stages = await prisma.stage.findMany();
    ctx.reply(
      `✅ User found: ${targetUser.username || targetUserId}\n\nWhich Stage will they manage?`,
      Markup.keyboard([...stages.map((s) => [s.name]), ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return ctx.reply("⚠️ Please select a valid stage.");

    await prisma.user.update({
      where: { id: ctx.wizard.state.targetUserId },
      data: { role: "admin", managedStageId: stage.id },
    });

    ctx.reply(
      `🎉 Success! User has been promoted to Admin for **${stage.name}**.\n\nTell them to type /start to refresh their menu.`,
      adminPanelKeyboard(ctx),
    );
    return ctx.scene.leave();
  },
);

const broadcastGroupWizard = new Scenes.WizardScene(
  "BROADCAST_GROUP_SCENE",
  async (ctx) => {
    const user = ctx.state.dbUser;

    if (user.role === "admin") {
      const stage = await prisma.stage.findUnique({ where: { id: user.managedStageId } });
      if (!stage || !stage.telegramGroupId) {
        return ctx.scene.leave(
          ctx.reply(
            "❌ Error: Your stage doesn't have a linked group yet. Add the bot to your group and type /link.",
            adminPanelKeyboard(ctx),
          ),
        );
      }

      ctx.wizard.state.targetGroupId = stage.telegramGroupId;
      ctx.reply(
        `📢 **Broadcast to ${stage.name}**\n\nType the announcement message you want to send to the group:`,
        Markup.keyboard([["❌ Cancel"]]).resize(),
      );

      ctx.wizard.selectStep(2);
      return;
    } else {
      const stages = await prisma.stage.findMany({
        where: { telegramGroupId: { not: null } },
      });
      if (stages.length === 0)
        return ctx.scene.leave(
          ctx.reply(
            "❌ No stages have linked groups yet.",
            adminPanelKeyboard(ctx),
          ),
        );

      ctx.reply(
        "📢 Select the Stage group to broadcast to:",
        Markup.keyboard([
          ...stages.map((s) => [s.name]),
          ["❌ Cancel"],
        ]).resize(),
      );
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage || !stage.telegramGroupId)
      return ctx.reply("⚠️ Invalid selection or group not linked.");

    ctx.wizard.state.targetGroupId = stage.telegramGroupId;
    ctx.reply(
      "Type the announcement message you want to send to the group:",
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    const announcementText = ctx.message.text;

    try {
      await ctx.telegram.sendMessage(
        ctx.wizard.state.targetGroupId,
        `${announcementText}`,
      );
      ctx.reply("✅ Announcement sent successfully!", adminPanelKeyboard(ctx));
    } catch (error) {
      ctx.reply(
        "❌ Failed to send. Make sure the bot is still an admin in that group.",
        adminPanelKeyboard(ctx),
      );
    }

    return ctx.scene.leave();
  },
);

const editWelcomeMsgWizard = new Scenes.WizardScene(
  "EDIT_WELCOME_SCENE",
  (ctx) => {
    ctx.reply(
      `✍️ Type the new welcome message for users:\nYou can use "#الاسم" in the message, and it will be replaced with the user's first name when they start the bot.`,
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx.message?.text))
      return ctx.scene.leave(ctx.reply("Cancelled.", adminPanelKeyboard(ctx)));

    const newMsg = ctx.message.text;

    await timeIt(
      "DB: Update Welcome Message",
      prisma.botSettings.update({
        where: { singletonId: "default" },
        data: { welcomeMessage: newMsg },
      }),
    );

    ctx.reply(
      "✅ Welcome message updated for all users!",
      adminPanelKeyboard(ctx),
    );
    return ctx.scene.leave();
  },
);

// --- EDIT HOMEWORK SCENE ---
const editHomeworkWizard = new Scenes.WizardScene(
  "EDIT_HOMEWORK_SCENE",
  // STEP 1: Route based on Role
  async (ctx) => {
    const user = ctx.state.dbUser;
    if (user.role === "admin") {
      if (!user.managedStageId) {
        await ctx.reply("❌ You are not assigned to manage any stage.");
        return ctx.scene.leave();
      }
      ctx.wizard.state.stageId = user.managedStageId;
      await ctx.reply("📝 Please send the new Homework text for your stage:");
      return ctx.wizard.selectStep(2); // Skip Step 2 and go straight to Step 3
    }

    // If Owner: Ask which stage to edit
    const stages = await prisma.stage.findMany();
    await ctx.reply(
      "🎓 Select the Stage to update homework for:",
      Markup.keyboard([...stages.map((s) => [s.name]), ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  // STEP 2: Handle Owner's Stage Selection
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("Cancelled.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }
    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return ctx.reply("⚠️ Please select a valid stage.");

    ctx.wizard.state.stageId = stage.id;
    await ctx.reply(
      `📝 Please send the new Homework text for **${stage.name}**:`,
    );
    return ctx.wizard.next();
  },
  // STEP 3: Receive and Save the Homework Text
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("Cancelled.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    const newHomework = ctx.message.text;
    await prisma.stage.update({
      where: { id: ctx.wizard.state.stageId },
      data: { homeworkText: newHomework },
    });

    await ctx.reply("✅ Homework updated successfully!", mainMenuKeyboard(ctx));
    return ctx.scene.leave();
  },
);

// --- EDIT SCHEDULE SCENE ---
const editScheduleWizard = new Scenes.WizardScene(
  "EDIT_SCHEDULE_SCENE",
  // STEP 1: Route based on Role
  async (ctx) => {
    const user = ctx.state.dbUser;
    if (user.role === "admin") {
      if (!user.managedStageId) {
        await ctx.reply("❌ You are not assigned to manage any stage.");
        return ctx.scene.leave();
      }
      ctx.wizard.state.stageId = user.managedStageId;
      await ctx.reply(
        "📅 Please upload the new Schedule **Image** for your stage:",
      );
      return ctx.wizard.selectStep(2);
    }

    // If Owner
    const stages = await prisma.stage.findMany();
    await ctx.reply(
      "🎓 Select the Stage to update the schedule for:",
      Markup.keyboard([...stages.map((s) => [s.name]), ["❌ Cancel"]]).resize(),
    );
    return ctx.wizard.next();
  },
  // STEP 2: Handle Owner's Stage Selection
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("Cancelled.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }
    const stage = await prisma.stage.findFirst({ where: { name: ctx.message.text } });
    if (!stage) return ctx.reply("⚠️ Please select a valid stage.");

    ctx.wizard.state.stageId = stage.id;
    await ctx.reply(
      `📅 Please upload the new Schedule **Image** for **${stage.name}**:`,
    );
    return ctx.wizard.next();
  },
  // STEP 3: Receive Image and Save
  async (ctx) => {
    if (isCancel(ctx.message?.text)) {
      await ctx.reply("Cancelled.", mainMenuKeyboard(ctx));
      return ctx.scene.leave();
    }

    if (!ctx.message?.photo) {
      return ctx.reply(
        "⚠️ Please upload an image (photo), not a document or text.",
      );
    }

    // Grab the highest resolution photo from the Admin's message
    const photoArray = ctx.message.photo;
    const bestPhoto = photoArray[photoArray.length - 1];

    // 1. FORWARD TO YOUR PRIVATE CHANNEL FOR PERMANENT SAFEKEEPING
    let permanentImageId;
    try {
      const channelMsg = await ctx.telegram.sendPhoto(
        process.env.CHANNEL_ID,
        bestPhoto.file_id,
        {
          caption: `📅 Schedule Backup (Stage ID: ${ctx.wizard.state.stageId})`,
        },
      );
      // Grab the new, safe file_id from the channel message
      const channelPhotoArray = channelMsg.photo;
      permanentImageId =
        channelPhotoArray[channelPhotoArray.length - 1].file_id;
    } catch (error) {
      console.error("Failed to backup schedule to channel:", error);
      // Fallback to the original ID if the channel upload fails
      permanentImageId = bestPhoto.file_id;
    }

    // 2. SAVE THE SAFE ID TO THE DATABASE
    await prisma.stage.update({
      where: { id: ctx.wizard.state.stageId },
      data: { scheduleImageId: permanentImageId },
    });

    await ctx.reply(
      "✅ Schedule image saved and securely backed up!",
      mainMenuKeyboard(ctx),
    );

    return ctx.scene.leave();
  },
);

module.exports = {
  addStageWizard,
  addClassWizard,
  addLectureWizard,
  delStageWizard,
  delClassWizard,
  delLectureWizard,
  delArchiveWizard,
  addArchiveWizard,
  addCreativeWizard,
  delCreativeWizard,
  broadcastWizard,
  broadcastGroupWizard,
  promoteAdminWizard,
  editWelcomeMsgWizard,
  editHomeworkWizard,
  editScheduleWizard,
};
