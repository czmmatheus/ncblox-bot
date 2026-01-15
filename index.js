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

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;            // cargo staff
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1461273267225497754";
const BUYER_ROLE_ID = process.env.BUYER_ROLE_ID || "1459480515408171217";

const RATE_PER_1000 = 28;
const PRICE_MULT = 1.30; // +30% no preço (modo com taxa)
const PURPLE = 0x7c3aed;

const AUTO_CLOSE_MS = 24 * 60 * 60 * 1000; // 24h

const BANNER_URL = "https://cdn.discordapp.com/attachments/1428217284660564125/1461373724535029893/file_000000007a1471f6bb88daa791749f60.png?ex=696a51d6&is=69690056&hm=d85d13d5a32d0c1df315724e18a5d0d6817ae91ccf4a9e27a35c27a41c966400&";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltam variáveis: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}
if (!STAFF_ROLE_ID) {
  console.error("Falta STAFF_ROLE_ID (ID do cargo staff).");
  process.exit(1);
}

// ================== STOCK (persistente) ==================
const STOCK_FILE = path.join(__dirname, "stock.json");

function ensureStockFile() {
  if (!fs.existsSync(STOCK_FILE)) {
    fs.writeFileSync(
      STOCK_FILE,
      JSON.stringify({ stock: 0, panelMessageId: null, panelChannelId: null }, null, 2),
      "utf8"
    );
  }
}
function readStockData() {
  ensureStockFile();
  try {
    const data = JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"));
    return {
      stock: Number(data.stock) || 0,
      panelMessageId: data.panelMessageId ?? null,
      panelChannelId: data.panelChannelId ?? null,
    };
  } catch {
    return { stock: 0, panelMessageId: null, panelChannelId: null };
  }
}
function writeStockData(obj) {
  ensureStockFile();
  fs.writeFileSync(STOCK_FILE, JSON.stringify(obj, null, 2), "utf8");
}

function formatStock(n) {
  return Math.max(0, Number(n) || 0).toLocaleString("pt-BR");
}
function stockBadge(stock) {
  if (stock <= 0) return "🔴 **SEM STOCK**";
  if (stock < 1000) return "🔴 **BAIXO**";
  if (stock < 5000) return "🟡 **MÉDIO**";
  return "🟢 **OK**";
}

// ================== HELPERS ==================
function brl(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function priceBRL(robux, withTax) {
  const base = (robux / 1000) * RATE_PER_1000;
  return withTax ? base * PRICE_MULT : base;
}
function formatDateDDMMYY(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
function hasStaffRole(member) {
  return member?.roles?.cache?.has(STAFF_ROLE_ID);
}

// ================== ROBLOX GAMEPASS (pega Nome + Robux) ==================
function extractGamePassId(urlOrId = "") {
  const s = String(urlOrId).trim();
  const m = s.match(/game-pass\/(\d+)/i);
  if (m?.[1]) return m[1];
  if (/^\d{6,}$/.test(s)) return s;
  return null;
}

async function fetchGamePassInfo(gamepassId) {
  // API oficial que retorna Nome e PriceInRobux
  const api = `https://economy.roblox.com/v1/game-pass/${gamepassId}/game-pass-product-info`;
  const res = await fetch(api, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) throw new Error(`Roblox API falhou: ${res.status}`);
  const j = await res.json();

  const name = j?.Name || j?.name || "Gamepass";
  const robux = Number(j?.PriceInRobux ?? j?.priceInRobux);
  if (!Number.isFinite(robux)) throw new Error("Preço em Robux não encontrado");

  return { name, robux };
}

// ================== BOT ==================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  // Tenta atualizar painel ao iniciar (se já existir)
  try { await updatePanelMessage(); } catch {}
});

// ================== PANEL (cria + atualiza) ==================
function buildMainPanelEmbed(stock) {
  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫")
    .setDescription(
      [
        "**Robux & Gamepass**",
        "",
        "📦 **𝗦𝗧𝗢𝗖𝗞 𝗔𝗧𝗨𝗔𝗟**",
        `➡️ **${formatStock(stock)} ROBUX DISPONÍVEIS** ${stockBadge(stock)}`,
        "",
        "💰 **Preços**",
        `• 1000 Robux = ${brl(RATE_PER_1000)}`,
        `• Com taxa (+30%) = ${brl(RATE_PER_1000 * PRICE_MULT)}`,
        "",
        "🔒 Compras via **ticket**",
        "📄 Vendas registradas",
        "🏷️ Cargo comprador",
        "",
        "👇 Selecione uma opção abaixo",
      ].join("\n")
    )
    .setImage(BANNER_URL);
}

function buildMainPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("buy_robux").setLabel("Comprar Robux").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("send_gamepass").setLabel("Enviar Gamepass (in-game)").setStyle(ButtonStyle.Secondary),
  );
}

async function sendMainPanel(channel) {
  const data = readStockData();
  const msg = await channel.send({ embeds: [buildMainPanelEmbed(data.stock)], components: [buildMainPanelRow()] });

  // salva os IDs pra atualizar sempre
  data.panelChannelId = channel.id;
  data.panelMessageId = msg.id;
  writeStockData(data);

  return msg;
}

async function updatePanelMessage() {
  const data = readStockData();
  if (!data.panelChannelId || !data.panelMessageId) return false;

  const ch = await client.channels.fetch(data.panelChannelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return false;

  const msg = await ch.messages.fetch(data.panelMessageId).catch(() => null);
  if (!msg) return false;

  await msg.edit({ embeds: [buildMainPanelEmbed(data.stock)], components: [buildMainPanelRow()] });
  return true;
}

// ================== CALC PANEL ==================
async function sendCalcPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫")
    .setDescription(
      [
        "**Calculadora de Robux**",
        "",
        `• Base: **1000 = ${brl(RATE_PER_1000)}**`,
        `• Com taxa: **+30% no preço**`,
        "",
        "Clique em uma opção para calcular:",
      ].join("\n")
    )
    .setImage(BANNER_URL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("calc_no_tax").setLabel("Calcular (Sem taxa)").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("calc_with_tax").setLabel("Calcular (Com taxa)").setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ================== TICKET CREATION ==================
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

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
    topic,
  });

  return { channel, openedAt };
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
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Fechar ticket").setStyle(ButtonStyle.Danger)
  );
}

async function finalizeTicket(channel, reason = "Finalizado") {
  cancelTicketTimer(channel.id);
  setTimeout(async () => { try { await channel.delete(reason); } catch {} }, 5000);
}

// ================== EXTRAIR PEDIDO (para /logs e /gamepass) ==================
async function extractOrderFromTicket(channel) {
  const msgs = await channel.messages.fetch({ limit: 50 });

  for (const [, msg] of msgs) {
    if (!msg.author || msg.author.id !== client.user.id) continue;
    if (!msg.embeds || msg.embeds.length === 0) continue;

    const e = msg.embeds[0];
    const title = (e.title || "").toLowerCase();
    const desc = e.description || "";

    if (title.includes("novo pedido") && title.includes("robux")) {
      const robuxMatch = desc.match(/\*\*Robux:\*\*\s*([0-9]+)/i);
      const totalMatch = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i);
      const modoMatch = desc.match(/\*\*Modo:\*\*\s*(.+)/i);

      const robux = robuxMatch ? Number(robuxMatch[1]) : null;
      const totalStr = totalMatch ? totalMatch[1] : null;
      const modo = modoMatch ? modoMatch[1].split("\n")[0].trim() : "—";

      let total = null;
      if (totalStr) total = Number(totalStr.replace(/\./g, "").replace(",", "."));

      if (Number.isFinite(robux) && robux > 0 && Number.isFinite(total) && total > 0) {
        return { type: "robux", robux, total: round2(total), modo };
      }
    }

    if (title.includes("pedido de gamepass")) {
      const nameMatch = desc.match(/\*\*Gamepass:\*\*\s*(.+)/i);
      const robuxMatch = desc.match(/\*\*Robux:\*\*\s*([0-9]+)/i);
      const totalMatch = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i);

      const gpName = nameMatch ? nameMatch[1].split("\n")[0].trim() : "Gamepass";
      const robux = robuxMatch ? Number(robuxMatch[1]) : null;

      let total = null;
      if (totalMatch?.[1]) total = Number(totalMatch[1].replace(/\./g, "").replace(",", "."));

      if (Number.isFinite(robux) && robux > 0 && Number.isFinite(total) && total > 0) {
        return { type: "gamepass", robux, total: round2(total), modo: `Gamepass: ${gpName}` };
      }
    }
  }

  return null;
}

// ================== COMMANDS REGISTER ==================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("cmd").setDescription("Painel principal (vendas)"),
    new SlashCommandBuilder().setName("2cmd").setDescription("Painel da calculadora (sem tickets)"),
    new SlashCommandBuilder().setName("logs").setDescription("Finaliza venda de Robux (log + cargo + fecha + desconta stock)"),
    new SlashCommandBuilder().setName("gamepass").setDescription("Finaliza venda de Gamepass (log + cargo + fecha + desconta stock)"),
    new SlashCommandBuilder()
      .setName("stock")
      .setDescription("Atualiza o stock: /stock 10000 (add) | /stock -100 (remove)")
      .addIntegerOption(o => o.setName("valor").setDescription("Número (pode ser negativo)").setRequired(true)),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /cmd /2cmd /logs /gamepass /stock registrados");
}

// ================== INTERACTIONS ==================
client.on("interactionCreate", async (i) => {
  try {
    // /cmd
    if (i.isChatInputCommand() && i.commandName === "cmd") {
      await sendMainPanel(i.channel);
      return i.reply({ content: "✅ Painel enviado e registrado.", ephemeral: true });
    }

    // /2cmd
    if (i.isChatInputCommand() && i.commandName === "2cmd") {
      await sendCalcPanel(i.channel);
      return i.reply({ content: "✅ Painel da calculadora enviado.", ephemeral: true });
    }

    // /stock (ADD/SUB)
    if (i.isChatInputCommand() && i.commandName === "stock") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Só staff.", ephemeral: true });

      const val = i.options.getInteger("valor", true);
      const data = readStockData();

      data.stock = Math.max(0, (Number(data.stock) || 0) + val); // + adiciona / - remove
      writeStockData(data);

      await updatePanelMessage().catch(() => null);

      return i.reply({ content: `📦 Stock atualizado: **${formatStock(data.stock)} Robux**`, ephemeral: true });
    }

    // /logs (Robux)
    if (i.isChatInputCommand() && i.commandName === "logs") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Só staff.", ephemeral: true });

      const ownerId = parseTicketOwnerIdFromTopic(i.channel?.topic || "");
      if (!ownerId) return i.reply({ content: "❌ Use dentro de um ticket.", ephemeral: true });

      await i.deferReply({ ephemeral: true });

      const order = await extractOrderFromTicket(i.channel);
      if (!order || order.type !== "robux") return i.editReply("❌ Não achei pedido de ROBUX nesse ticket.");

      // desconta stock
      const data = readStockData();
      data.stock = Math.max(0, data.stock - order.robux);
      writeStockData(data);
      await updatePanelMessage().catch(() => null);

      // manda log
      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada (Robux)")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Robux", value: `${order.robux}`, inline: true },
          { name: "Total", value: brl(order.total), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Modo", value: order.modo, inline: false },
          { name: "Stock restante", value: `${formatStock(data.stock)} Robux`, inline: false },
          { name: "Staff", value: `<@${i.user.id}>`, inline: false },
        );

      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      // cargo comprador
      try {
        const member = await i.guild.members.fetch(ownerId);
        if (member && !member.roles.cache.has(BUYER_ROLE_ID)) await member.roles.add(BUYER_ROLE_ID, "Compra registrada (/logs)");
      } catch {}

      await i.channel.send(`✅ Venda registrada. 📦 Stock agora: **${formatStock(data.stock)}**. 🔒 Fechando...`);
      await i.editReply("✅ Log registrado. Fechando ticket...");
      await finalizeTicket(i.channel, "Venda finalizada (/logs)");
      return;
    }

    // /gamepass (finaliza gamepass)
    if (i.isChatInputCommand() && i.commandName === "gamepass") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Só staff.", ephemeral: true });

      const ownerId = parseTicketOwnerIdFromTopic(i.channel?.topic || "");
      if (!ownerId) return i.reply({ content: "❌ Use dentro de um ticket.", ephemeral: true });

      await i.deferReply({ ephemeral: true });

      const order = await extractOrderFromTicket(i.channel);
      if (!order || order.type !== "gamepass") return i.editReply("❌ Não achei pedido de GAMEPASS nesse ticket.");

      // desconta stock
      const data = readStockData();
      data.stock = Math.max(0, data.stock - order.robux);
      writeStockData(data);
      await updatePanelMessage().catch(() => null);

      // manda log
      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada (Gamepass)")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Robux", value: `${order.robux}`, inline: true },
          { name: "Total", value: brl(order.total), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Detalhes", value: order.modo, inline: false },
          { name: "Stock restante", value: `${formatStock(data.stock)} Robux`, inline: false },
          { name: "Staff", value: `<@${i.user.id}>`, inline: false },
        );

      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      // cargo comprador
      try {
        const member = await i.guild.members.fetch(ownerId);
        if (member && !member.roles.cache.has(BUYER_ROLE_ID)) await member.roles.add(BUYER_ROLE_ID, "Compra registrada (/gamepass)");
      } catch {}

      await i.channel.send(`✅ Venda registrada. 📦 Stock agora: **${formatStock(data.stock)}**. 🔒 Fechando...`);
      await i.editReply("✅ Venda registrada. Fechando ticket...");
      await finalizeTicket(i.channel, "Venda finalizada (/gamepass)");
      return;
    }

    // Botões painel
    if (i.isButton() && i.customId === "buy_robux") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("robux_mode")
        .setPlaceholder("Escolha o modo")
        .addOptions([
          { label: "Sem taxa", value: "no_tax" },
          { label: "Com taxa (+30% no preço)", value: "with_tax" },
        ]);

      return i.reply({
        content: "Escolha uma opção:",
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    }

    // Enviar Gamepass (agora só Nick + Link)
    if (i.isButton() && i.customId === "send_gamepass") {
      const modal = new ModalBuilder()
        .setCustomId("gamepass_modal")
        .setTitle("Enviar Gamepass (in-game)");

      const nick = new TextInputBuilder()
        .setCustomId("nick")
        .setLabel("Nick do Roblox")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const link = new TextInputBuilder()
        .setCustomId("gplink")
        .setLabel("Link da Gamepass do Roblox")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nick),
        new ActionRowBuilder().addComponents(link)
      );

      return i.showModal(modal);
    }

    // Select Robux mode -> modal
    if (i.isStringSelectMenu() && i.customId === "robux_mode") {
      const mode = i.values[0];
      const modal = new ModalBuilder().setCustomId(`robux_order:${mode}`).setTitle("Pedido de Robux");

      const nick = new TextInputBuilder().setCustomId("nick").setLabel("Nick do Roblox").setStyle(TextInputStyle.Short).setRequired(true);
      const robux = new TextInputBuilder().setCustomId("robux").setLabel("Quantidade de Robux").setStyle(TextInputStyle.Short).setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(nick), new ActionRowBuilder().addComponents(robux));
      return i.showModal(modal);
    }

    // Calculadora
    if (i.isButton() && (i.customId === "calc_no_tax" || i.customId === "calc_with_tax")) {
      const withTax = i.customId === "calc_with_tax";

      const modal = new ModalBuilder()
        .setCustomId(`calc_modal:${withTax ? "with" : "no"}`)
        .setTitle(withTax ? "Calculadora (Com taxa)" : "Calculadora (Sem taxa)");

      const robux = new TextInputBuilder()
        .setCustomId("robux")
        .setLabel("Quantidade de Robux")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(robux));
      return i.showModal(modal);
    }

    // Submit Robux order -> ticket
    if (i.isModalSubmit() && i.customId.startsWith("robux_order:")) {
      await i.deferReply({ ephemeral: true });

      const mode = i.customId.split(":")[1];
      const withTax = mode === "with_tax";

      const nick = i.fields.getTextInputValue("nick").trim();
      const robux = Number(i.fields.getTextInputValue("robux").replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) return i.editReply("❌ Quantidade inválida.");

      const total = round2(priceBRL(robux, withTax));
      const { channel: ticket, openedAt } = await createTicketChannel(i.guild, i.user);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧾 Novo pedido de Robux")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Robux:** ${robux}`,
            `**Modo:** ${withTax ? "Com taxa (+30% no preço)" : "Sem taxa"}`,
            `**Total:** ${brl(total)}`,
            "",
            "📌 **Instruções:**",
            `1) Crie uma **Gamepass de ${robux} Robux**`,
            "2) Envie o link aqui no ticket",
            "",
            "⏳ Fecha em **24h** automaticamente.",
            "✅ Staff finaliza com **/logs**.",
          ].join("\n")
        );

      await ticket.send({ content: `<@&${STAFF_ROLE_ID}> Novo pedido!`, embeds: [embed], components: [buildTicketButtons()] });
      await scheduleAutoClose(ticket, openedAt);

      return i.editReply(`✅ Ticket criado: ${ticket}`);
    }

    // Submit Gamepass modal -> ticket (lê link, pega nome+robux)
    if (i.isModalSubmit() && i.customId === "gamepass_modal") {
      await i.deferReply({ ephemeral: true });

      const nick = i.fields.getTextInputValue("nick").trim();
      const gplink = i.fields.getTextInputValue("gplink").trim();

      const id = extractGamePassId(gplink);
      if (!id) return i.editReply("❌ Link/ID inválido.");

      let info;
      try {
        info = await fetchGamePassInfo(id);
      } catch (e) {
        console.error(e);
        return i.editReply("❌ Não consegui ler essa Gamepass agora. Tente novamente.");
      }

      // Gamepass sem taxa (como você pediu)
      const total = round2(priceBRL(info.robux, false));

      const { channel: ticket, openedAt } = await createTicketChannel(i.guild, i.user);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🎮 Pedido de Gamepass (in-game)")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Gamepass:** ${info.name}`,
            `**Robux:** ${info.robux}`,
            `**Link:** ${gplink}`,
            `**Total:** ${brl(total)}`,
            "",
            "⏳ Fecha em **24h** automaticamente.",
            "✅ Staff finaliza com **/gamepass**.",
          ].join("\n")
        );

      await ticket.send({ content: `<@&${STAFF_ROLE_ID}> Novo pedido (Gamepass)!`, embeds: [embed], components: [buildTicketButtons()] });
      await scheduleAutoClose(ticket, openedAt);

      return i.editReply(`✅ Ticket criado: ${ticket}`);
    }

    // Submit calculator
    if (i.isModalSubmit() && i.customId.startsWith("calc_modal:")) {
      const withTax = i.customId.endsWith(":with");
      const robux = Number(i.fields.getTextInputValue("robux").replace(/[^\d]/g, ""));
      if (!robux || robux <= 0) return i.reply({ content: "❌ Quantidade inválida.", ephemeral: true });

      const total = round2(priceBRL(robux, withTax));
      const other = round2(priceBRL(robux, !withTax));

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧮 Resultado da calculadora")
        .setDescription(
          [
            `**Robux:** ${robux}`,
            "",
            `**Sem taxa:** ${brl(withTax ? other : total)}`,
            `**Com taxa (+30%):** ${brl(withTax ? total : other)}`,
          ].join("\n")
        );

      return i.reply({ embeds: [embed], ephemeral: true });
    }

    // Close ticket
    if (i.isButton() && i.customId === "close_ticket") {
      const ownerId = parseTicketOwnerIdFromTopic(i.channel?.topic || "");
      const isOwner = ownerId && i.user.id === ownerId;
      const isStaff = hasStaffRole(i.member);

      if (!isOwner && !isStaff) return i.reply({ content: "❌ Você não pode fechar este ticket.", ephemeral: true });

      await i.reply({ content: "🔒 Fechando ticket em 5 segundos...", ephemeral: true });
      await finalizeTicket(i.channel, "Ticket fechado manualmente");
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