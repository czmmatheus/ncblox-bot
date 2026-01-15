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

const axios = require("axios");
const cheerio = require("cheerio");

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

// Banner que você mandou
const BANNER_URL = "https://cdn.discordapp.com/attachments/1428217284660564125/1461373724535029893/file_000000007a1471f6bb88daa791749f60.png?ex=696a51d6&is=69690056&hm=d85d13d5a32d0c1df315724e18a5d0d6817ae91ccf4a9e27a35c27a41c966400&";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltam variáveis: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}
if (!STAFF_ROLE_ID) {
  console.error("Falta STAFF_ROLE_ID (ID do cargo staff).");
  process.exit(1);
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
function priceGamepassBRL(robux) {
  return (robux / 1000) * RATE_PER_1000; // A: 1000 = R$28
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
function parseTicketOwnerIdFromTopic(topic = "") {
  const m = topic.match(/ticketOwner:(\d+)/);
  return m?.[1] || null;
}

// ================== SCRAPER (opcional: nome/preço do link) ==================
async function fetchGamepassInfo(url) {
  const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const $ = cheerio.load(data);

  const name =
    $('h1[itemprop="name"]').text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    "Gamepass";

  let priceTxt =
    $('[data-testid="price-label"]').first().text() ||
    $('[class*="price"]').first().text() ||
    "";

  const robux = Number(priceTxt.replace(/[^\d]/g, ""));
  if (!robux || robux <= 0) throw new Error("Não foi possível ler o preço em Robux.");

  return { name, robux };
}

// ================== TIMERS (auto-close) ==================
const ticketTimers = new Map(); // channelId -> timeout

function cancelTicketTimer(channelId) {
  if (ticketTimers.has(channelId)) {
    clearTimeout(ticketTimers.get(channelId));
    ticketTimers.delete(channelId);
  }
}

// ================== COMMANDS REGISTER ==================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("cmd").setDescription("Painel principal (vendas)"),
    new SlashCommandBuilder().setName("2cmd").setDescription("Painel da calculadora (sem tickets)"),
    new SlashCommandBuilder().setName("logs").setDescription("Registra a venda do ticket (auto), dá cargo e fecha"),
    new SlashCommandBuilder().setName("gamepass").setDescription("Registra venda de Gamepass (auto), dá cargo e fecha"),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /cmd /2cmd /logs /gamepass registrados");
}

// ================== BOT ==================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.once("ready", () => console.log(`✅ Logado como ${client.user.tag}`));

// ================== PANELS ==================
async function sendMainPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("NCBlox Store")
    .setDescription(
      [
        "**Robux & Gamepass**",
        "",
        `• **Sem taxa:** 1000 = ${brl(RATE_PER_1000)}`,
        `• **Com taxa (+30% no preço):** 1000 = ${brl(RATE_PER_1000 * PRICE_MULT)}`,
        "",
        "Escolha uma opção abaixo:",
      ].join("\n")
    )
    .setImage(BANNER_URL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy_robux")
      .setLabel("Comprar Robux")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("send_gamepass")
      .setLabel("Gamepass")
      .setStyle(ButtonStyle.Secondary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function sendCalcPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("NCBlox Store")
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
    new ButtonBuilder()
      .setCustomId("calc_no_tax")
      .setLabel("Calcular (Sem taxa)")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("calc_with_tax")
      .setLabel("Calcular (Com taxa)")
      .setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ================== TICKET CREATION ==================
async function createTicketChannel(guild, user) {
  const safeName = (user.username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12) || "user";

  const channelName = `ticket-${safeName}-${user.id.toString().slice(-4)}`;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    {
      id: STAFF_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
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
      setTimeout(async () => {
        try { await channel.delete("Auto-close 24h"); } catch {}
      }, 5000);
    } catch {}
    ticketTimers.delete(channel.id);
  }, msLeft);

  ticketTimers.set(channel.id, t);
}

function buildTicketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Fechar ticket")
      .setStyle(ButtonStyle.Danger)
  );
}

async function finalizeTicket(channel, reason = "Finalizado") {
  cancelTicketTimer(channel.id);
  setTimeout(async () => {
    try { await channel.delete(reason); } catch {}
  }, 5000);
}

// ================== ORDER EXTRACTION ==================
async function extractOrderFromTicket(channel) {
  const msgs = await channel.messages.fetch({ limit: 50 });

  for (const [, msg] of msgs) {
    if (!msg.author || msg.author.id !== client.user.id) continue;
    if (!msg.embeds || msg.embeds.length === 0) continue;

    const e = msg.embeds[0];
    const title = (e.title || "").toLowerCase();
    const desc = e.description || "";

    // Robux
    if (title.includes("novo pedido") && title.includes("robux")) {
      const robuxMatch = desc.match(/\*\*Robux:\*\*\s*([0-9]+)/i);
      const totalMatch = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i);
      const modoMatch = desc.match(/\*\*Modo:\*\*\s*(.+)/i);

      const robux = robuxMatch ? Number(robuxMatch[1]) : null;
      const totalStr = totalMatch ? totalMatch[1] : null;
      const modo = modoMatch ? modoMatch[1].split("\n")[0].trim() : "—";

      let total = null;
      if (totalStr) {
        total = Number(totalStr.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(total)) total = null;
      }

      if (Number.isFinite(robux) && robux > 0 && Number.isFinite(total) && total > 0) {
        return { type: "robux", robux, total: round2(total), modo };
      }
    }

    // Gamepass (novo)
    if (title.includes("pedido") && title.includes("gamepass")) {
      const nickMatch = desc.match(/\*\*Nick:\*\*\s*(.+)/i);
      const linkMatch = desc.match(/\*\*Link:\*\*\s*(.+)/i);
      const robuxMatch = desc.match(/\*\*Robux:\*\*\s*([0-9]+)/i);
      const totalMatch = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i);

      const nick = nickMatch ? nickMatch[1].split("\n")[0].trim() : null;
      const link = linkMatch ? linkMatch[1].split("\n")[0].trim() : null;
      const robux = robuxMatch ? Number(robuxMatch[1]) : null;

      let total = null;
      if (totalMatch?.[1]) {
        total = Number(totalMatch[1].replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(total)) total = null;
      }

      if (nick && link && Number.isFinite(robux) && robux > 0 && Number.isFinite(total) && total > 0) {
        return { type: "gamepass", nick, link, robux, total: round2(total), modo: "Gamepass" };
      }
    }
  }

  return null;
}

// ================== INTERACTIONS ==================
client.on("interactionCreate", async (i) => {
  try {
    // ---------- Slash commands ----------
    if (i.isChatInputCommand() && i.commandName === "cmd") {
      await sendMainPanel(i.channel);
      return i.reply({ content: "✅ Painel enviado.", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "2cmd") {
      await sendCalcPanel(i.channel);
      return i.reply({ content: "✅ Painel da calculadora enviado.", ephemeral: true });
    }

    // ---------- /logs (Robux) ----------
    if (i.isChatInputCommand() && i.commandName === "logs") {
      if (!hasStaffRole(i.member)) {
        return i.reply({ content: "❌ Você não tem permissão para usar /logs.", ephemeral: true });
      }

      const channel = i.channel;
      const ownerId = parseTicketOwnerIdFromTopic(channel?.topic || "");
      if (!ownerId) {
        return i.reply({ content: "❌ Use /logs dentro de um ticket criado pelo bot.", ephemeral: true });
      }

      await i.deferReply({ ephemeral: true });

      const order = await extractOrderFromTicket(channel);
      if (!order || order.type !== "robux") {
        return i.editReply("❌ Não achei o pedido de Robux nesse ticket.");
      }

      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada (Robux)")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Total", value: brl(order.total), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Modo", value: order.modo, inline: false },
          { name: "Ticket", value: `${channel}`, inline: false },
          { name: "Staff", value: `<@${i.user.id}>`, inline: false },
          { name: "Robux", value: `${order.robux}`, inline: true },
        );

      if (logChannel && logChannel.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: "⚠️ Canal de logs inválido/sem permissão.", embeds: [embed] });
      }

      try {
        const member = await i.guild.members.fetch(ownerId);
        if (member && !member.roles.cache.has(BUYER_ROLE_ID)) {
          await member.roles.add(BUYER_ROLE_ID, "Compra registrada via /logs");
        }
      } catch {}

      await channel.send(`✅ Venda registrada por <@${i.user.id}>. 🏷️ Cargo aplicado. 🔒 Fechando em 5s...`);
      await i.editReply("✅ Log registrado. Fechando ticket...");
      await finalizeTicket(channel, "Venda finalizada via /logs");
      return;
    }

    // ---------- /gamepass (Gamepass) ----------
    if (i.isChatInputCommand() && i.commandName === "gamepass") {
      if (!hasStaffRole(i.member)) {
        return i.reply({ content: "❌ Você não tem permissão para usar /gamepass.", ephemeral: true });
      }

      const channel = i.channel;
      const ownerId = parseTicketOwnerIdFromTopic(channel?.topic || "");
      if (!ownerId) {
        return i.reply({ content: "❌ Use /gamepass dentro de um ticket criado pelo bot.", ephemeral: true });
      }

      await i.deferReply({ ephemeral: true });

      const order = await extractOrderFromTicket(channel);
      if (!order || order.type !== "gamepass") {
        return i.editReply("❌ Não achei o pedido de Gamepass nesse ticket.");
      }

      // tenta pegar nome real pelo link (opcional)
      let gpName = "Gamepass";
      try {
        const info = await fetchGamepassInfo(order.link);
        gpName = info?.name || gpName;
      } catch {}

      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada (Gamepass)")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Nick", value: order.nick, inline: true },
          { name: "Gamepass", value: gpName, inline: false },
          { name: "Robux", value: `${order.robux}`, inline: true },
          { name: "Total", value: brl(order.total), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Link", value: order.link, inline: false },
          { name: "Ticket", value: `${channel}`, inline: false },
          { name: "Staff", value: `<@${i.user.id}>`, inline: false },
        );

      if (logChannel && logChannel.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: "⚠️ Canal de logs inválido/sem permissão.", embeds: [embed] });
      }

      try {
        const member = await i.guild.members.fetch(ownerId);
        if (member && !member.roles.cache.has(BUYER_ROLE_ID)) {
          await member.roles.add(BUYER_ROLE_ID, "Compra registrada via /gamepass");
        }
      } catch {}

      await channel.send(`✅ Gamepass registrada por <@${i.user.id}>. 🏷️ Cargo aplicado. 🔒 Fechando em 5s...`);
      await i.editReply("✅ Log registrado. Fechando ticket...");
      await finalizeTicket(channel, "Venda finalizada via /gamepass");
      return;
    }

    // ---------- Main panel buttons ----------
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

    // --- NOVO Gamepass: Nick + Link + Robux ---
    if (i.isButton() && i.customId === "send_gamepass") {
      const modal = new ModalBuilder()
        .setCustomId("gamepass_modal")
        .setTitle("Pedido de Gamepass");

      const nick = new TextInputBuilder()
        .setCustomId("nick")
        .setLabel("Nick do Roblox")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const link = new TextInputBuilder()
        .setCustomId("gplink")
        .setLabel("Link da Gamepass")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const robux = new TextInputBuilder()
        .setCustomId("robux")
        .setLabel("Quantidade de Robux")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nick),
        new ActionRowBuilder().addComponents(link),
        new ActionRowBuilder().addComponents(robux),
      );

      return i.showModal(modal);
    }

    // ---------- Robux mode select -> modal ----------
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
        .setLabel("Quantidade de Robux")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nick),
        new ActionRowBuilder().addComponents(robux)
      );

      return i.showModal(modal);
    }

    // ---------- Calculator panel buttons ----------
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

    // ---------- Submit: Robux order -> ticket ----------
    if (i.isModalSubmit() && i.customId.startsWith("robux_order:")) {
      await i.deferReply({ ephemeral: true });

      const mode = i.customId.split(":")[1];
      const withTax = mode === "with_tax";

      const nick = i.fields.getTextInputValue("nick").trim();
      const robuxRaw = i.fields.getTextInputValue("robux").trim();
      const robux = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) {
        return i.editReply("❌ Quantidade inválida.");
      }

      const total = round2(priceBRL(robux, withTax));

      let ticket, openedAt;
      try {
        const res = await createTicketChannel(i.guild, i.user);
        ticket = res.channel;
        openedAt = res.openedAt;
      } catch (err) {
        return i.editReply("❌ Não consegui criar o canal do ticket.");
      }

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
            "✅ Staff usa **/logs** para registrar e fechar.",
          ].join("\n")
        );

      await ticket.send({
        content: `<@&${STAFF_ROLE_ID}> Novo pedido!`,
        embeds: [embed],
        components: [buildTicketButtons()],
      });

      await scheduleAutoClose(ticket, openedAt);
      return i.editReply(`✅ Ticket criado: ${ticket}`);
    }

    // ---------- Submit: Gamepass -> ticket ----------
    if (i.isModalSubmit() && i.customId === "gamepass_modal") {
      await i.deferReply({ ephemeral: true });

      const nick = i.fields.getTextInputValue("nick").trim();
      const link = i.fields.getTextInputValue("gplink").trim();
      const robuxRaw = i.fields.getTextInputValue("robux").trim();
      const robux = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) {
        return i.editReply("❌ Robux inválido.");
      }

      const total = round2(priceGamepassBRL(robux));

      let ticket, openedAt;
      try {
        const res = await createTicketChannel(i.guild, i.user);
        ticket = res.channel;
        openedAt = res.openedAt;
      } catch (err) {
        return i.editReply("❌ Não consegui criar o canal do ticket.");
      }

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🎮 Pedido de Gamepass")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Link:** ${link}`,
            `**Robux:** ${robux}`,
            `**Total:** ${brl(total)}`,
            "",
            "✅ Staff usa **/gamepass** para registrar e fechar.",
          ].join("\n")
        );

      await ticket.send({
        content: `<@&${STAFF_ROLE_ID}> Novo pedido (Gamepass)!`,
        embeds: [embed],
        components: [buildTicketButtons()],
      });

      await scheduleAutoClose(ticket, openedAt);
      return i.editReply(`✅ Ticket criado: ${ticket}`);
    }

    // ---------- Submit: Calculator ----------
    if (i.isModalSubmit() && i.customId.startsWith("calc_modal:")) {
      const mode = i.customId.split(":")[1];
      const withTax = mode === "with";

      const robuxRaw = i.fields.getTextInputValue("robux").trim();
      const robux = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) {
        return i.reply({ content: "❌ Quantidade inválida.", ephemeral: true });
      }

      const total = round2(priceBRL(robux, withTax));
      const other = round2(priceBRL(robux, !withTax));

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧮 Resultado da calculadora")
        .setDescription(
          [
            `**Robux:** ${robux}`,
            `**Base:** 1000 = ${brl(RATE_PER_1000)}`,
            "",
            `**${withTax ? "Com taxa (+30%)" : "Sem taxa"}:** ${brl(total)}`,
            `**${withTax ? "Sem taxa" : "Com taxa (+30%)"}:** ${brl(other)}`,
          ].join("\n")
        );

      return i.reply({ embeds: [embed], ephemeral: true });
    }

    // ---------- Close ticket button ----------
    if (i.isButton() && i.customId === "close_ticket") {
      const channel = i.channel;
      const ownerId = parseTicketOwnerIdFromTopic(channel?.topic || "");

      const isOwner = ownerId && i.user.id === ownerId;
      const isStaff = hasStaffRole(i.member);

      if (!isOwner && !isStaff) {
        return i.reply({ content: "❌ Você não pode fechar este ticket.", ephemeral: true });
      }

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