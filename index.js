// BASE OFICIAL: NCBlox (Robux + Tickets + Logs + Stock)
// Alterações futuras serão aplicadas aqui, sem misturar outros scripts.

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

const fs = require("fs");
const path = require("path");

// ================== CONFIG / ENV ==================
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
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

function readStock() {
  try {
    if (!fs.existsSync(STOCK_FILE)) fs.writeFileSync(STOCK_FILE, JSON.stringify({ stock: 0 }, null, 2));
    const data = JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"));
    return Number(data.stock) || 0;
  } catch {
    return 0;
  }
}

function writeStock(value) {
  const safe = Math.max(0, Math.floor(value));
  fs.writeFileSync(STOCK_FILE, JSON.stringify({ stock: safe }, null, 2));
  return safe;
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
function stockBadge(stock) {
  if (stock <= 0) return "❌ **ESGOTADO**";
  if (stock < 1000) return "🔴 **BAIXO**";
  if (stock < 5000) return "🟡 **MÉDIO**";
  return "🟢 **OK**";
}

// Timers em memória (auto-close)
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

// ================== COMMANDS REGISTER ==================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("cmd").setDescription("Painel principal (vendas)"),
    new SlashCommandBuilder().setName("2cmd").setDescription("Painel da calculadora (sem tickets)"),
    new SlashCommandBuilder().setName("logs").setDescription("Registra a venda do ticket (auto), dá cargo, desconta stock e fecha"),
    new SlashCommandBuilder()
      .setName("stock")
      .setDescription("Define ou remove stock de Robux")
      .addIntegerOption(o => o.setName("valor").setDescription("Ex: 10000 (set) ou -500 (remove)").setRequired(true)),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /cmd /2cmd /logs /stock registrados");
}

// ================== BOT ==================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("ready", () => console.log(`✅ Logado como ${client.user.tag}`));

// ================== PANELS ==================
async function sendMainPanel(channel) {
  const stock = readStock();
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫")
    .setDescription(
      [
        "**Robux & Gamepass**",
        "",
        "📦 **𝗦𝗧𝗢𝗖𝗞 𝗔𝗧𝗨𝗔𝗟**",
        `➡️ **${stock.toLocaleString("pt-BR")} ROBUX DISPONÍVEIS** ${stockBadge(stock)}`,
        "",
        "💰 **Preços**",
        `• 1000 Robux = ${brl(RATE_PER_1000)}`,
        `• Com taxa (+30%) = ${brl(RATE_PER_1000 * PRICE_MULT)}`,
        "",
        "🔒 Compras via **ticket**",
        "📄 Vendas registradas",
        "🏷️ Cargo de comprador",
        "",
        "👇 Selecione uma opção abaixo",
      ].join("\n")
    )
    .setImage(BANNER_URL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("buy_robux").setLabel("Comprar Robux").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("send_gamepass").setLabel("Enviar Gamepass (in-game)").setStyle(ButtonStyle.Secondary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

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
        "Clique em uma opção:",
      ].join("\n")
    )
    .setImage(BANNER_URL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("calc_no_tax").setLabel("Sem taxa").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("calc_with_tax").setLabel("Com taxa").setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ================== TICKET CREATION ==================
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

// ================== ORDER EXTRACTION FOR /logs ==================
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
      if (totalStr) {
        total = Number(totalStr.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(total)) total = null;
      }
      if (Number.isFinite(robux) && robux > 0 && Number.isFinite(total) && total > 0) {
        return { type: "robux", robux, total: round2(total), modo };
      }
    }
  }
  return null;
}

// ================== INTERACTIONS ==================
client.on("interactionCreate", async (i) => {
  try {
    // Slash
    if (i.isChatInputCommand() && i.commandName === "cmd") {
      await sendMainPanel(i.channel);
      return i.reply({ content: "✅ Painel enviado.", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "2cmd") {
      await sendCalcPanel(i.channel);
      return i.reply({ content: "✅ Calculadora enviada.", ephemeral: true });
    }

    if (i.isChatInputCommand() && i.commandName === "stock") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const val = i.options.getInteger("valor");
      const current = readStock();
      let next = current;

      if (val < 0) next = current + val; // remove
      else next = val; // set

      next = Math.max(0, next);
      writeStock(next);
      return i.reply({ content: `📦 Stock atualizado: **${next.toLocaleString("pt-BR")} Robux**`, ephemeral: true });
    }

    // /logs
    if (i.isChatInputCommand() && i.commandName === "logs") {
      if (!hasStaffRole(i.member)) return i.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const channel = i.channel;
      const ownerId = parseTicketOwnerIdFromTopic(channel?.topic || "");
      if (!ownerId) return i.reply({ content: "❌ Use dentro de um ticket.", ephemeral: true });

      await i.deferReply({ ephemeral: true });
      const order = await extractOrderFromTicket(channel);
      if (!order) return i.editReply("❌ Não achei o pedido.");

      // Desconta stock
      const current = readStock();
      if (order.robux > current) {
        return i.editReply(`❌ Stock insuficiente. Atual: ${current}`);
      }
      const newStock = writeStock(current - order.robux);

      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Robux", value: `${order.robux}`, inline: true },
          { name: "Total", value: brl(order.total), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Modo", value: order.modo, inline: false },
          { name: "Stock restante", value: `${newStock.toLocaleString("pt-BR")}`, inline: false },
          { name: "Staff", value: `<@${i.user.id}>`, inline: false },
        );

      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      try {
        const member = await i.guild.members.fetch(ownerId);
        if (!member.roles.cache.has(BUYER_ROLE_ID)) await member.roles.add(BUYER_ROLE_ID);
      } catch {}

      await channel.send(`✅ Venda registrada. 📦 Stock agora: **${newStock.toLocaleString("pt-BR")}**. 🔒 Fechando...`);
      await i.editReply("Registrado.");
      await finalizeTicket(channel, "Venda finalizada");
      return;
    }

    // Buttons / Modals
    if (i.isButton() && i.customId === "buy_robux") {
      const menu = new StringSelectMenuBuilder().setCustomId("robux_mode").setPlaceholder("Escolha").addOptions(
        { label: "Sem taxa", value: "no_tax" },
        { label: "Com taxa (+30%)", value: "with_tax" },
      );
      return i.reply({ content: "Escolha:", components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (i.isStringSelectMenu() && i.customId === "robux_mode") {
      const mode = i.values[0];
      const modal = new ModalBuilder().setCustomId(`robux_order:${mode}`).setTitle("Pedido de Robux");
      const nick = new TextInputBuilder().setCustomId("nick").setLabel("Nick").setStyle(TextInputStyle.Short).setRequired(true);
      const robux = new TextInputBuilder().setCustomId("robux").setLabel("Robux").setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(nick), new ActionRowBuilder().addComponents(robux));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith("robux_order:")) {
      await i.deferReply({ ephemeral: true });
      const withTax = i.customId.endsWith("with_tax");
      const nick = i.fields.getTextInputValue("nick").trim();
      const robux = Number(i.fields.getTextInputValue("robux").replace(/[^\d]/g, ""));
      if (!robux || robux <= 0) return i.editReply("❌ Robux inválido.");

      const stock = readStock();
      if (robux > stock) return i.editReply(`❌ Stock insuficiente. Atual: ${stock}`);

      const total = round2(priceBRL(robux, withTax));
      const { channel, openedAt } = await createTicketChannel(i.guild, i.user);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧾 Novo pedido de Robux")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Robux:** ${robux}`,
            `**Modo:** ${withTax ? "Com taxa (+30%)" : "Sem taxa"}`,
            `**Total:** ${brl(total)}`,
            "",
            `📦 **Stock atual:** ${stock.toLocaleString("pt-BR")}`,
            "",
            "Crie uma **Gamepass de mesmo valor em Robux** e envie o link.",
            "⏳ Ticket fecha em 24h.",
          ].join("\n")
        );

      await channel.send({ content: `<@&${STAFF_ROLE_ID}>`, embeds: [embed], components: [buildTicketButtons()] });
      await scheduleAutoClose(channel, openedAt);
      return i.editReply(`✅ Ticket criado: ${channel}`);
    }

    if (i.isButton() && i.customId === "calc_no_tax" || i.isButton() && i.customId === "calc_with_tax") {
      const withTax = i.customId === "calc_with_tax";
      const modal = new ModalBuilder().setCustomId(`calc_modal:${withTax ? "with" : "no"}`).setTitle("Calculadora");
      const robux = new TextInputBuilder().setCustomId("robux").setLabel("Robux").setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(robux));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith("calc_modal:")) {
      const withTax = i.customId.endsWith(":with");
      const robux = Number(i.fields.getTextInputValue("robux").replace(/[^\d]/g, ""));
      if (!robux) return i.reply({ content: "❌ Inválido.", ephemeral: true });
      const total = round2(priceBRL(robux, withTax));
      const other = round2(priceBRL(robux, !withTax));
      const embed = new EmbedBuilder().setColor(PURPLE).setTitle("🧮 Resultado").setDescription(
        `Robux: **${robux}**\n${withTax ? "Com taxa" : "Sem taxa"}: **${brl(total)}**\n${withTax ? "Sem taxa" : "Com taxa"}: **${brl(other)}**`
      );
      return i.reply({ embeds: [embed], ephemeral: true });
    }

    if (i.isButton() && i.customId === "close_ticket") {
      const ownerId = parseTicketOwnerIdFromTopic(i.channel?.topic || "");
      if (i.user.id !== ownerId && !hasStaffRole(i.member)) return i.reply({ content: "❌ Sem permissão.", ephemeral: true });
      await i.reply({ content: "🔒 Fechando...", ephemeral: true });
      await finalizeTicket(i.channel, "Fechado manualmente");
    }

  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      try { await i.reply({ content: "❌ Erro. Veja os logs.", ephemeral: true }); } catch {}
    }
  }
});

// ================== START ==================
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();