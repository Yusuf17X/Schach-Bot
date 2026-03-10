const { Markup } = require("telegraf");

// Custom Timer Wrapper
const timeIt = async (label, promise) => {
  const start = Date.now();
  try {
    const result = await promise;
    console.log(`[Timer] ${label} took ${Date.now() - start}ms`);
    return result;
  } catch (err) {
    console.log(`[Timer] ${label} FAILED after ${Date.now() - start}ms`);
    throw err;
  }
};

const isCancel = (text) =>
  text === "❌ Cancel" ||
  text === "🔝 القائمة الرئيسية" ||
  text?.startsWith("/");

// Inside utils.js
const mainMenuKeyboard = (ctx) => {
  const buttons = [
    ["🔄 تغيير المرحلة", "📚 المحاضرات"],
    ["📦 الارشيف", "🎨 الادوات المساعدة"],
  ];

  // Grab the role from ctx.state.dbUser
  const role = ctx.state.dbUser?.role;

  // If they are admin or owner, show the button
  if (role === "admin" || role === "owner") {
    buttons.push(["⚙️ Admin"]);
  }

  return Markup.keyboard(buttons).resize();
};

const adminPanelKeyboard = (ctx) => {
  const role = ctx.state.dbUser?.role;

  const buttons = [];

  if (role === "owner") {
    buttons.push(
      ["📝 تعديل الواجبات", "📝 تعديل الجدول"],
      ["➕ اضافة مرحلة", "❌ حذف مرحلة"],
      ["➕ اضافة مادة", "❌ حذف مادة"],
      ["➕ اضافة محاضرة", "❌ حذف محاضرة"],
      ["➕ اضافة ارشيف", "❌ حذف الارشيف"],
      ["➕ اضافة الادوات المساعدة", "❌ حذف الادوات المساعدة"],
      ["📢 رسالة جماعية", "📢 ارسال اعلان للكروب"],
      ["✏️ تعديل الرسالة الترحيبية"],
      ["👑 اضافة ادمن"],
    );
  } else if (role === "admin") {
    buttons.push(
      ["📝 تعديل الواجبات", "📝 تعديل الجدول"],
      ["➕ اضافة مادة", "❌ حذف مادة"],
      ["➕ اضافة محاضرة", "❌ حذف محاضرة"],
      ["📢 ارسال اعلان للكروب"],
    );
  }
  buttons.push(["🔝 القائمة الرئيسية"]);
  return Markup.keyboard(buttons).resize();
};

// This object will hold pending notifications: { stageId: { timeout: timer, updates: [] } }
const notificationQueue = {};

const queueGroupNotification = (ctx, stage, update) => {
  const stageId = stage._id.toString();

  if (!notificationQueue[stageId]) {
    notificationQueue[stageId] = { updates: [], timeout: null };
  }

  // update now contains { className, fileNames, category }
  notificationQueue[stageId].updates.push(update);

  if (!notificationQueue[stageId].timeout) {
    notificationQueue[stageId].timeout = setTimeout(async () => {
      await sendBatchNotification(ctx, stageId, stage.telegramGroupId);
    }, 30000);
  }
};

const sendBatchNotification = async (ctx, stageId, groupId) => {
  const queue = notificationQueue[stageId];
  if (!queue || queue.updates.length === 0) return;

  // Aggregate file names by Class and Category
  const summary = queue.updates.reduce((acc, curr) => {
    if (!acc[curr.className]) acc[curr.className] = { theory: [], lab: [] };

    // Push all filenames from this batch into the correct category array
    acc[curr.className][curr.category].push(...curr.fileNames);
    return acc;
  }, {});

  let message = "";

  // Use .forEach() to build the list
  Object.entries(summary).forEach(([className, categories]) => {
    message += `📚 ${className}: `;

    if (categories.theory.length > 0) {
      message += `Theory: ${categories.theory.join(", ")}\n`;
    }

    if (categories.lab.length > 0) {
      message += `Lab: ${categories.lab.join(", ")}\n`;
    }

    message += `\n`;
  });

  message += "صارت بالبوت";

  try {
    if (groupId) {
      await ctx.telegram.sendMessage(groupId, message);
    }
  } catch (err) {
    console.error("Batch notification failed:", err.message);
  } finally {
    delete notificationQueue[stageId];
  }
};

module.exports = {
  timeIt,
  isCancel,
  mainMenuKeyboard,
  adminPanelKeyboard,
  queueGroupNotification,
};
