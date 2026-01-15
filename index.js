const fs = require("fs");
const path = require("path");
const {
  Client, GatewayIntentBits,
  REST, Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder, TextInputStyle,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");

// ================== CONFIG / ENV ==================
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1461273267225497754";
const BUYER_ROLE_ID = process.env.BUYER_ROLE_ID || "1459480515408171217";
const PENDING_CHANNEL_ID = process.env.PENDING_CHANNEL_ID || "1461472410061770872";

const PURPLE = 0x7c3aed;
const AUTO_CLOSE_MS = 24 * 60 * 60 * 1000;
const PRICE_MULT_OLD = 1.30; // (se você ainda quiser usar +30% no preço em algum lugar)

const BANNER_URL = "https://cdn.discordapp.com/attachments/1428217284660564125/1461373724535029893/file_000000007a1471f6bb88daa791749f60.png?ex=696a51d6&is=69690056&hm=d85d13d5a32d0c1df315724e18a5d0d6817ae91ccf4a9e27a35c27a41c966400&";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltam variáveis: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}
if (!STAFF_ROLE_ID) {
  console.error("Falta STAFF_ROLE_ID.");
  process.exit(1);
}

// ================== JSON (stock + config) ==================
const STOCK_PATH = path.join(__dirname, "stock.json");

function ensureFile() {
  if (!fs.existsSync(STOCK_PATH)) {
    fs.writeFileSync(STOCK_PATH, JSON.stringify({
      stock: 0,
      panelMessageId: null,
      panelChannelId: null,
      ratePer1000: 28,
      discountPct: 0,
      cmdLabel: "/cmd",
    }, null, 2), "utf8");
  }
}

function readState() {
  ensureFile();
  try {
    const data = JSON.parse(fs.readFileSync(STOCK_PATH, "utf8"));
    // defaults / migração
    if (!Number.isFinite(Number(data.stock))) data.stock = 0;
    if (!Number.isFinite(Number(data.ratePer1000)) || Number(data.ratePer1000) <= 0) data.ratePer1000 = 28;
    if (!Number.isFinite(Number(data.discountPct)) || Number(data.discountPct) < 0) data.discountPct = 0;
    if (Number(data.discountPct) > 100) data.discountPct = 100;
    if (typeof data.cmdLabel !== "string" || !data.cmdLabel.trim()) data.cmdLabel = "/cmd";
    if (!("panelMessageId" in data)) data.panelMessageId = null;
    if (!("panelChannelId" in data)) data.panelChannelId = null;
    return data;
  } catch {
    return {
      stock: 0,
      panelMessageId: null,
      panelChannelId: null,
      ratePer1000: 28,
      discountPct: 0,
      cmdLabel: "/cmd",
    };
  }
}

function writeState(next) {
  ensureFile();
  fs.writeFileSync(STOCK_PATH, JSON.stringify(next, null, 2), "utf8");
}

// ================== HELPERS ==================
function brl(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function formatIntPT(n) {
  return Math.trunc(n).toLocaleString("pt-BR");
}
function hasStaffRole(member) {
  return member?.roles?.cache?.has(STAFF_ROLE_ID);
}
function formatDateDDMMYY(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

// --- desconto ---
function applyDiscount(value, discountPct) {
  const pct = Math.max(0, Math.min(100, Number(discountPct) || 0));
  return value * (1 - pct / 100);
}

// --- preço base ---
function priceBRLFromRobux(robuxGross) {
  const s = readState();
  return (robuxGross / 1000) * s.ratePer1000;
}

// --- Robux com taxa (cobrir 30% Roblox) ---
const ROBLOX_FEE = 0.30;
const NET_RATE = 1 - ROBLOX_FEE;       // 0.70
const COVER_FEE_MULT = 1 / NET_RATE;   // 1.42857...

function requiredRobuxToCoverFee(desiredNetRobux) {
  return Math.ceil(desiredNetRobux * COVER_FEE_MULT);
}

// --- GamePass +5% ---
const GAMEPASS_MARKUP = 0.05;
function gamepassTotalBRL(robuxPrice) {
  const base = priceBRLFromRobux(robuxPrice);
  return base * (1 + GAMEPASS_MARKUP);
}

// ================== BOT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once("ready", async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  try { await updateSavedCmdPanel(); } catch {}
});

// ================== REGISTER COMMANDS ==================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("cmd").setDescription("Painel principal (vendas)"),
    new SlashCommandBuilder().setName("2cmd").setDescription("Painel da calculadora (sem tickets)"),
    new SlashCommandBuilder().setName("paineladm").setDescription("Painel oculto ADM (ajustes)"),
    new SlashCommandBuilder()
      .setName("stock")
      .setDescription("Ajusta stock (ex: /stock 1000 ou /stock -100)")
      .addIntegerOption(o => o.setName("quantidade").setDescription("Use negativo para remover").setRequired(true)),
    new SlashCommandBuilder().setName("logs").setDescription("Registra venda do ticket (staff)"),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /cmd /2cmd /paineladm /stock /logs registrados");
}

// ================== PANELS ==================
function buildMainPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("buy_robux").setLabel("Comprar Robux").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("buy_gamepass").setLabel("Comprar GamePass").setStyle(ButtonStyle.Secondary),
  );
}

function buildMainPanelEmbed() {
  const s = readState();
  const status = s.stock > 0 ? "🟢 OK" : "🔴 SEM STOCK";

  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫")
    .setDescription(
      [
        `📌 **Comando do painel:** ${s.cmdLabel}`,
        "",
        "📦 **STOCK ATUAL**",
        `➡️ **${formatIntPT(s.stock)} ROBUX DISPONÍVEIS** ${status}`,
        "",
        "💰 **Preço base**",
        `• **1000 Robux = ${brl(s.ratePer1000)}**`,
        s.discountPct > 0 ? `• 🎁 **Desconto ativo: ${s.discountPct}%**` : "• Sem desconto",
        "",
        "👇 Selecione uma opção abaixo:",
      ].join("\n")
    )
    .setImage(BANNER_URL);
}

async function sendMainPanel(channel) {
  const msg = await channel.send({ embeds: [buildMainPanelEmbed()], components: [buildMainPanelRow()] });

  const s = readState();
  s.panelMessageId = msg.id;
  s.panelChannelId = channel.id;
  writeState(s);

  return msg;
}

async function updateSavedCmdPanel() {
  const s = readState();
  if (!s.panelChannelId || !s.panelMessageId) return;

  const ch = await client.channels.fetch(s.panelChannelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const msg = await ch.messages.fetch(s.panelMessageId).catch(() => null);
  if (!msg) return;

  await msg.edit({ embeds: [buildMainPanelEmbed()], components: [buildMainPanelRow()] }).catch(() => null);
}

async function sendCalcPanel(channel) {
  const s = readState();
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫")
    .setDescription(
      [
        "**Calculadora de Robux**",
        "",
        `• Base: **1000 = ${brl(s.ratePer1000)}**`,
        s.discountPct > 0 ? `• Desconto: **${s.discountPct}%**` : "• Desconto: **0%**",
        "",
        "Clique em uma opção para calcular:",
      ].join("\n")
    )
    .setImage(BANNER_URL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("calc_no_tax").setLabel("Calcular (Sem taxa)").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("calc_with_tax").setLabel("Calcular (Cobrir 30%)").setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ================== ADMIN PANEL (/paineladm) ==================
function buildAdmEmbed() {
  const s = readState();
  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫 • /CMD ADM")
    .setDescription(
      [
        "Painel oculto para ajustes internos.",
        "",
        `💰 **Preço base:** 1000 = ${brl(s.ratePer1000)}`,
        `🎁 **Desconto:** ${s.discountPct}%`,
        `🏷️ **Label do comando:** ${s.cmdLabel}`,
        "",
        "Use os botões abaixo:",
      ].join("\n")
    );
}

function buildAdmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("adm_set_rate").setLabel("Alterar preço (1000)").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("adm_set_discount").setLabel("Alterar desconto").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("adm_set_cmdlabel").setLabel("Alterar label /cmd").setStyle(ButtonStyle.Secondary),
  );
}

async function sendAdmPanel(channel) {
  await channel.send({ embeds: [buildAdmEmbed()], components: [buildAdmRow()] });
}

// ================== TICKETS ==================
const ticketTimers = new Map();

function cancelTicketTimer(channelId) {
  if (ticketTimers.has(channelId)) {
    clearTimeout(ticketTimers.get(channelId));
    ticketTimers.delete(channelId);
  }
}

function parseTicketOwnerIdFromTopic(topic = "") {
  const m = topic.match(/ticketOwner:(\d+)/);
  return m?.[1] || null;
}

async function createTicketChannel(guild, user) {
  const safeName = (user.username || "user").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  const channelName = `ticket-${safeName}-${user.id.toString().slice(-4)}`;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
  ];

  const openedAt = Date.now();
  const topic = `ticketOwner:${user.id} openedAt:${openedAt}`;

  const ch = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
    topic,
  });

  return { channel: ch, openedAt };
}

async function scheduleAutoClose(channel, openedAt) {
  cancelTicketTimer(channel.id);
  const msLeft = Math.max(0, (openedAt + AUTO_CLOSE_MS) - Date.now());

  const t = setTimeout(async () => {
    try {
      await channel.send("⏳ Ticket encerrado automaticamente após **24 horas**.");
      setTimeout(async () => { try { await channel.delete("Auto-close 24h"); } catch {} }, 5000);
    } catch {}
    ticketTimers.delete(channel.id);
  }, msLeft);

  ticketTimers.set(channel.id, t);
}

function buildTicketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Fechar ticket").setStyle(ButtonStyle.Danger),
  );
}

async function finalizeTicket(channel, reason = "Finalizado") {
  cancelTicketTimer(channel.id);
  setTimeout(async () => { try { await channel.delete(reason); } catch {} }, 5000);
}

// ================== /logs extractor (Robux ticket) ==================
async function extractOrderFromTicket(channel) {
  const msgs = await channel.messages.fetch({ limit: 50 });

  for (const [, msg] of msgs) {
    if (!msg.author || msg.author.id !== client.user.id) continue;
    if (!msg.embeds || msg.embeds.length === 0) continue;

    const e = msg.embeds[0];
    const title = (e.title || "").toLowerCase();
    const desc = e.description || "";

    if (title.includes("pedido") && title.includes("robux")) {
      const netMatch = desc.match(/\*\*Robux \(líquido\):\*\*\s*([0-9]+)/i);
      const grossMatch = desc.match(/\*\*Robux para comprar:\*\*\s*([0-9]+)/i);
      const totalMatch = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i);

      const robuxNet = netMatch ? Number(netMatch[1]) : null;
      const robuxGross = grossMatch ? Number(grossMatch[1]) : null;
      const totalStr = totalMatch ? totalMatch[1] : null;

      let total = null;
      if (totalStr) {
        total = Number(totalStr.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(total)) total = null;
      }

      if (Number.isFinite(robuxNet) && Number.isFinite(total)) {
        return { type: "robux", robuxNet, robuxGross: robuxGross || robuxNet, total };
      }
    }
  }
  return null;
}

// ================== INTERACTIONS ==================
client.on("interactionCreate", async (i) => {
  try {
    // Slash commands
    if (i.isChatInputCommand() && i.commandName === "cmd") {
      await sendMainPanel(i.channel);
      return i.reply({ content: "✅ Painel enviado e salvo.", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "2cmd") {
      await sendCalcPanel(i.channel);
      return i.reply({ content: "✅ Painel da calculadora enviado.", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "paineladm") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });
      await sendAdmPanel(i.channel);
      return i.reply({ content: "✅ Painel ADM enviado (oculto).", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "stock") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const q = i.options.getInteger("quantidade", true);
      const s = readState();
      s.stock = Math.max(0, (Number(s.stock) || 0) + q);
      writeState(s);

      await updateSavedCmdPanel().catch(() => null);
      return i.reply({ content: `📦 Stock agora: **${formatIntPT(s.stock)}**`, ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "logs") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const channel = i.channel;
      const ownerId = parseTicketOwnerIdFromTopic(channel?.topic || "");
      if (!ownerId) return i.reply({ content: "❌ Use dentro de ticket do bot.", ephemeral: true });

      await i.deferReply({ ephemeral: true });
      const order = await extractOrderFromTicket(channel);
      if (!order) return i.editReply("❌ Não achei o pedido nesse ticket.");

      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Total", value: brl(order.total), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Ticket", value: `${channel}`, inline: false },
          { name: "Staff", value: `<@${i.user.id}>`, inline: false },
          { name: "Robux (líquido)", value: `${order.robuxNet}`, inline: true },
          { name: "Robux para comprar", value: `${order.robuxGross}`, inline: true },
        );

      if (logChannel && logChannel.isTextBased()) await logChannel.send({ embeds: [embed] });

      // dá cargo comprador
      try {
        const member = await i.guild.members.fetch(ownerId);
        if (member && !member.roles.cache.has(BUYER_ROLE_ID)) {
          await member.roles.add(BUYER_ROLE_ID, "Compra registrada via /logs");
        }
      } catch {}

      // desconta stock (líquido)
      const s = readState();
      s.stock = Math.max(0, (Number(s.stock) || 0) - (Number(order.robuxNet) || 0));
      writeState(s);
      await updateSavedCmdPanel().catch(() => null);

      await channel.send(`✅ Venda registrada por <@${i.user.id}>. Fechando ticket...`);
      await i.editReply("✅ Log registrado. Fechando ticket...");
      await finalizeTicket(channel, "Venda finalizada via /logs");
      return;
    }

    // Admin panel buttons
    if (i.isButton() && i.customId === "adm_set_rate") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const modal = new ModalBuilder().setCustomId("adm_modal_rate").setTitle("Alterar preço base");
      const input = new TextInputBuilder()
        .setCustomId("rate")
        .setLabel("Novo preço (1000 Robux) em R$ (ex: 28 ou 29.5)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return i.showModal(modal);
    }

    if (i.isButton() && i.customId === "adm_set_discount") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const modal = new ModalBuilder().setCustomId("adm_modal_discount").setTitle("Alterar desconto");
      const input = new TextInputBuilder()
        .setCustomId("discount")
        .setLabel("Desconto em % (0 a 100)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return i.showModal(modal);
    }

    if (i.isButton() && i.customId === "adm_set_cmdlabel") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const modal = new ModalBuilder().setCustomId("adm_modal_cmdlabel").setTitle("Alterar label do comando");
      const input = new TextInputBuilder()
        .setCustomId("cmdlabel")
        .setLabel("Texto que aparece no painel (ex: /cmd ou /painel de venda)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return i.showModal(modal);
    }

    // Admin modals submit
    if (i.isModalSubmit() && i.customId === "adm_modal_rate") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const raw = i.fields.getTextInputValue("rate").trim().replace(",", ".");
      const val = Number(raw);

      if (!Number.isFinite(val) || val <= 0) {
        return i.reply({ content: "❌ Valor inválido.", ephemeral: true });
      }

      const s = readState();
      s.ratePer1000 = round2(val);
      writeState(s);

      await updateSavedCmdPanel().catch(() => null);
      return i.reply({ content: `✅ Preço base atualizado: 1000 = **${brl(s.ratePer1000)}**`, ephemeral: true });
    }

    if (i.isModalSubmit() && i.customId === "adm_modal_discount") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const raw = i.fields.getTextInputValue("discount").trim().replace(",", ".");
      const val = Number(raw);

      if (!Number.isFinite(val) || val < 0 || val > 100) {
        return i.reply({ content: "❌ Desconto inválido (0 a 100).", ephemeral: true });
      }

      const s = readState();
      s.discountPct = round2(val);
      writeState(s);

      await updateSavedCmdPanel().catch(() => null);
      return i.reply({ content: `✅ Desconto atualizado: **${s.discountPct}%**`, ephemeral: true });
    }

    if (i.isModalSubmit() && i.customId === "adm_modal_cmdlabel") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Apenas staff.", ephemeral: true });

      const txt = i.fields.getTextInputValue("cmdlabel").trim();
      if (!txt) return i.reply({ content: "❌ Texto vazio.", ephemeral: true });

      const s = readState();
      s.cmdLabel = txt.slice(0, 40);
      writeState(s);

      await updateSavedCmdPanel().catch(() => null);
      return i.reply({ content: `✅ Label atualizado no painel: **${s.cmdLabel}**`, ephemeral: true });
    }

    // Main panel -> robux select
    if (i.isButton() && i.customId === "buy_robux") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("robux_mode")
        .setPlaceholder("Escolha o modo")
        .addOptions([
          { label: "Sem taxa", value: "no_tax" },
          { label: "Com taxa (cobrir 30% Roblox)", value: "with_tax" },
        ]);

      return i.reply({
        content: "Escolha uma opção:",
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    }

    // Main panel -> gamepass (simples: nick + robux)
    if (i.isButton() && i.customId === "buy_gamepass") {
      const modal = new ModalBuilder().setCustomId("gp_modal").setTitle("Pedido de GamePass");

      const nick = new TextInputBuilder()
        .setCustomId("nick")
        .setLabel("Nick do Roblox")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const robux = new TextInputBuilder()
        .setCustomId("robux")
        .setLabel("Preço da GamePass (Robux)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nick),
        new ActionRowBuilder().addComponents(robux),
      );

      return i.showModal(modal);
    }

    // select -> modal robux order
    if (i.isStringSelectMenu() && i.customId === "robux_mode") {
      const mode = i.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`robux_order:${mode}`)
        .setTitle("Pedido de Robux");

      const nick = new TextInputBuilder()
        .setCustomId("nick")
        .setLabel("Nick do Roblox")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const robux = new TextInputBuilder()
        .setCustomId("robux")
        .setLabel("Robux que quer RECEBER (líquido)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nick),
        new ActionRowBuilder().addComponents(robux)
      );

      return i.showModal(modal);
    }

    // Calc buttons
    if (i.isButton() && (i.customId === "calc_no_tax" || i.customId === "calc_with_tax")) {
      const withTax = i.customId === "calc_with_tax";
      const modal = new ModalBuilder()
        .setCustomId(`calc_modal:${withTax ? "with" : "no"}`)
        .setTitle(withTax ? "Calculadora (Cobrir 30%)" : "Calculadora (Sem taxa)");

      const robux = new TextInputBuilder()
        .setCustomId("robux")
        .setLabel("Robux líquido desejado")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(robux));
      return i.showModal(modal);
    }

    // Submit: Robux order -> ticket
    if (i.isModalSubmit() && i.customId.startsWith("robux_order:")) {
      await i.deferReply({ ephemeral: true });

      const mode = i.customId.split(":")[1];
      const withTax = mode === "with_tax";

      const s = readState();

      const nick = i.fields.getTextInputValue("nick").trim();
      const robuxNet = Number(i.fields.getTextInputValue("robux").trim().replace(/[^\d]/g, ""));

      if (!Number.isFinite(robuxNet) || robuxNet <= 0) return i.editReply("❌ Quantidade inválida.");

      const robuxGross = withTax ? requiredRobuxToCoverFee(robuxNet) : robuxNet;

      let total = priceBRLFromRobux(robuxGross);
      total = applyDiscount(total, s.discountPct);
      total = round2(total);

      let ticket, openedAt;
      try {
        const res = await createTicketChannel(i.guild, i.user);
        ticket = res.channel;
        openedAt = res.openedAt;
      } catch {
        return i.editReply("❌ Não consegui criar o ticket (perm/categoria).");
      }

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧾 Pedido de Robux")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Robux (líquido):** ${robuxNet}`,
            `**Modo:** ${withTax ? "Cobrir 30% Roblox" : "Sem taxa"}`,
            `**Robux para comprar:** ${robuxGross}`,
            `**Preço base:** 1000 = ${brl(s.ratePer1000)}`,
            s.discountPct > 0 ? `**Desconto:** ${s.discountPct}%` : null,
            `**Total:** ${brl(total)}`,
            "",
            "⏳ Aguarde até 24h (auto-close).",
          ].filter(Boolean).join("\n")
        );

      await ticket.send({
        content: `<@&${STAFF_ROLE_ID}> Novo pedido!`,
        embeds: [embed],
        components: [buildTicketButtons()],
      });

      await scheduleAutoClose(ticket, openedAt);
      return i.editReply(`✅ Ticket criado: ${ticket}`);
    }

    // Submit: GamePass -> ticket (+5% e desconto)
    if (i.isModalSubmit() && i.customId === "gp_modal") {
      await i.deferReply({ ephemeral: true });

      const s = readState();
      const nick = i.fields.getTextInputValue("nick").trim();
      const robux = Number(i.fields.getTextInputValue("robux").trim().replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) return i.editReply("❌ Robux inválido.");

      let total = gamepassTotalBRL(robux);  // +5%
      total = applyDiscount(total, s.discountPct);
      total = round2(total);

      let ticket, openedAt;
      try {
        const res = await createTicketChannel(i.guild, i.user);
        ticket = res.channel;
        openedAt = res.openedAt;
      } catch {
        return i.editReply("❌ Não consegui criar o ticket (perm/categoria).");
      }

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🎮 Pedido de GamePass")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Robux:** ${robux}`,
            `**Regra:** 1000 = ${brl(s.ratePer1000)} + 5%`,
            s.discountPct > 0 ? `**Desconto:** ${s.discountPct}%` : null,
            `**Total:** ${brl(total)}`,
            "",
            "⏳ Aguarde até 24h (auto-close).",
          ].filter(Boolean).join("\n")
        );

      await ticket.send({
        content: `<@&${STAFF_ROLE_ID}> Novo pedido (GamePass)!`,
        embeds: [embed],
        components: [buildTicketButtons()],
      });

      await scheduleAutoClose(ticket, openedAt);
      return i.editReply(`✅ Ticket criado: ${ticket}`);
    }

    // Submit: calculator
    if (i.isModalSubmit() && i.customId.startsWith("calc_modal:")) {
      const mode = i.customId.split(":")[1];
      const withTax = mode === "with";

      const s = readState();
      const robuxNet = Number(i.fields.getTextInputValue("robux").trim().replace(/[^\d]/g, ""));
      if (!Number.isFinite(robuxNet) || robuxNet <= 0) return i.reply({ content: "❌ Inválido.", ephemeral: true });

      const robuxGross = withTax ? requiredRobuxToCoverFee(robuxNet) : robuxNet;

      let total = priceBRLFromRobux(robuxGross);
      total = applyDiscount(total, s.discountPct);
      total = round2(total);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧮 Resultado")
        .setDescription(
          [
            `**Robux (líquido):** ${robuxNet}`,
            withTax ? `**Robux para comprar:** ${robuxGross}` : null,
            `**Preço base:** 1000 = ${brl(s.ratePer1000)}`,
            s.discountPct > 0 ? `**Desconto:** ${s.discountPct}%` : null,
            `**Total:** ${brl(total)}`,
          ].filter(Boolean).join("\n")
        );

      return i.reply({ embeds: [embed], ephemeral: true });
    }

    // close ticket
    if (i.isButton() && i.customId === "close_ticket") {
      const channel = i.channel;
      const ownerId = parseTicketOwnerIdFromTopic(channel?.topic || "");
      const isOwner = ownerId && i.user.id === ownerId;
      const isStaff = hasStaffRole(i.member);

      if (!isOwner && !isStaff) return i.reply({ content: "❌ Você não pode fechar este ticket.", ephemeral: true });

      await i.reply({ content: "🔒 Fechando ticket em 5 segundos...", ephemeral: true });
      await finalizeTicket(channel, "Ticket fechado manualmente");
      return;
    }

  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      try { await i.reply({ content: "❌ Erro. Veja os logs do Railway.", ephemeral: true }); } catch {}
    }
  }
});

// ================== START ==================
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();