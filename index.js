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

const RATE_PER_1000 = 28;  // 1000 Robux = R$ 28,00
const PURPLE = 0x7c3aed;

const AUTO_CLOSE_MS = 24 * 60 * 60 * 1000; // 24h

// Banner
const BANNER_URL = "https://cdn.discordapp.com/attachments/1428217284660564125/1461373724535029893/file_000000007a1471f6bb88daa791749f60.png?ex=696a51d6&is=69690056&hm=d85d13d5a32d0c1df315724e18a5d0d6817ae91ccf4a9e27a35c27a41c966400&";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltam variáveis: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}
if (!STAFF_ROLE_ID) {
  console.error("Falta STAFF_ROLE_ID (ID do cargo staff).");
  process.exit(1);
}

// ================== STOCK JSON ==================
const STOCK_PATH = path.join(__dirname, "stock.json");

function ensureStockFile() {
  if (!fs.existsSync(STOCK_PATH)) {
    fs.writeFileSync(STOCK_PATH, JSON.stringify({
      stock: 0,
      panelMessageId: null,
      panelChannelId: null
    }, null, 2));
  }
}

function readStockState() {
  ensureStockFile();
  try {
    const raw = fs.readFileSync(STOCK_PATH, "utf8");
    const data = JSON.parse(raw);
    return {
      stock: Number(data.stock) || 0,
      panelMessageId: data.panelMessageId || null,
      panelChannelId: data.panelChannelId || null,
    };
  } catch {
    return { stock: 0, panelMessageId: null, panelChannelId: null };
  }
}

function writeStockState(next) {
  ensureStockFile();
  fs.writeFileSync(STOCK_PATH, JSON.stringify(next, null, 2));
}

function formatRobux(n) {
  const x = Number(n) || 0;
  return x.toLocaleString("pt-BR");
}

// ================== HELPERS ==================
function brl(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function priceBRLFromRobux(robux) {
  const base = (robux / 1000) * RATE_PER_1000;
  return base;
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

// ================== ROBLOX 30% (CORRIGIDO) ==================
const ROBLOX_FEE = 0.30;
const NET_RATE = 1 - ROBLOX_FEE;       // 0.70
const COVER_FEE_MULT = 1 / NET_RATE;   // 1.42857...

// Se você quer RECEBER X robux (líquido), precisa cobrar:
function requiredRobuxToCoverFee(desiredNetRobux) {
  return Math.ceil(desiredNetRobux * COVER_FEE_MULT);
}

// ================== GAMEPASS LINK READER (TENTATIVA FORTE) ==================
function extractGamepassId(text = "") {
  const m = String(text).match(/game-pass\/(\d+)/i);
  return m ? m[1] : null;
}

// usa endpoint product-info (Node 18+ tem fetch global; Railway costuma ter)
async function fetchGamepassInfo(gamepassId) {
  const url = `https://economy.roblox.com/v1/game-passes/${gamepassId}/product-info`;

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "application/json",
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const name = data?.Name || null;
    const price = Number(data?.PriceInRobux);

    if (!name || !Number.isFinite(price)) return null;
    return { name, price };
  } catch {
    return null;
  }
}

// ================== BOT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, // necessário para fetch de mensagens no ticket
  ]
});

client.once("ready", async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  // tenta atualizar painel quando liga
  try { await updatePanelIfExists(); } catch {}
});

// ================== COMMANDS REGISTER ==================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("cmd").setDescription("Painel principal (vendas)"),
    new SlashCommandBuilder().setName("2cmd").setDescription("Painel da calculadora (sem tickets)"),
    new SlashCommandBuilder().setName("logs").setDescription("Registra a venda do ticket (auto), dá cargo, fecha e desconta stock"),
    new SlashCommandBuilder()
      .setName("stock")
      .setDescription("Altera o stock (ex: /stock 10000 ou /stock -100)")
      .addIntegerOption(o => o.setName("quantidade").setDescription("Número (use negativo para remover)").setRequired(true)),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /cmd /2cmd /logs /stock registrados");
}

// ================== PANELS ==================
function buildMainPanelEmbed(stockValue) {
  const ok = stockValue > 0;
  const status = ok ? "🟢 OK" : "🔴 SEM STOCK";

  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫")
    .setDescription(
      [
        "**Robux & Gamepass**",
        "",
        "📦 **STOCK ATUAL**",
        `➡️ **${formatRobux(stockValue)} ROBUX DISPONÍVEIS**  ${status}`,
        "",
        "💰 **Preços**",
        `• 1000 Robux = ${brl(RATE_PER_1000)}`,
        `• **Com taxa Roblox (30%)**: o bot calcula o Robux necessário pra você receber o líquido`,
        "",
        "🔒 Compras via **ticket**",
        "✅ Vendas registradas",
        "🏷️ Cargo de comprador",
        "",
        "👇 Selecione uma opção abaixo",
      ].join("\n")
    )
    .setImage(BANNER_URL);
}

async function sendMainPanel(channel) {
  const state = readStockState();
  const embed = buildMainPanelEmbed(state.stock);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy_robux")
      .setLabel("Comprar Robux")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("send_gamepass")
      .setLabel("Enviar Gamepass (in-game)")
      .setStyle(ButtonStyle.Secondary),
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });

  // salva IDs pra atualizar depois
  writeStockState({
    stock: state.stock,
    panelMessageId: msg.id,
    panelChannelId: channel.id
  });

  return msg;
}

async function updatePanelIfExists() {
  const state = readStockState();
  if (!state.panelMessageId || !state.panelChannelId) return;

  const ch = await client.channels.fetch(state.panelChannelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const msg = await ch.messages.fetch(state.panelMessageId).catch(() => null);
  if (!msg) return;

  const embed = buildMainPanelEmbed(state.stock);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy_robux")
      .setLabel("Comprar Robux")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("send_gamepass")
      .setLabel("Enviar Gamepass (in-game)")
      .setStyle(ButtonStyle.Secondary),
  );

  await msg.edit({ embeds: [embed], components: [row] }).catch(() => null);
}

// Painel calculadora (sem tickets)
async function sendCalcPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("𝗡𝗖 𝗕𝗟𝗢𝗫")
    .setDescription(
      [
        "**Calculadora de Robux**",
        "",
        `• Base: **1000 = ${brl(RATE_PER_1000)}**`,
        `• Modo **Com taxa**: cobre os **30% do Roblox** (calcula Robux necessário)`,
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
const ticketTimers = new Map(); // channelId -> timeout

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

// ================== ORDER EXTRACTION FOR /logs ==================
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
      const netMatch = desc.match(/\*\*Robux \(líquido\):\*\*\s*([0-9]+)/i);
      const grossMatch = desc.match(/\*\*Robux para comprar:\*\*\s*([0-9]+)/i);
      const totalMatch = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i);
      const modoMatch = desc.match(/\*\*Modo:\*\*\s*(.+)/i);

      const net = netMatch ? Number(netMatch[1]) : null;
      const gross = grossMatch ? Number(grossMatch[1]) : null;
      const totalStr = totalMatch ? totalMatch[1] : null;
      const modo = modoMatch ? modoMatch[1].split("\n")[0].trim() : "—";

      let total = null;
      if (totalStr) {
        total = Number(totalStr.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(total)) total = null;
      }

      if (Number.isFinite(net) && net > 0 && Number.isFinite(total) && total > 0) {
        return { type: "robux", robuxNet: net, robuxGross: gross || net, total: round2(total), modo };
      }
    }

    // Gamepass (in-game)
    if (title.includes("pedido") && title.includes("gamepass")) {
      const totalMatch = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i);
      const totalStr = totalMatch ? totalMatch[1] : null;

      let total = null;
      if (totalStr) {
        total = Number(totalStr.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(total)) total = null;
      }

      if (Number.isFinite(total) && total > 0) {
        return { type: "gamepass", total: round2(total), modo: "Gamepass (in-game)" };
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

    if (i.isChatInputCommand() && i.commandName === "stock") {
      if (!hasStaffRole(i.member)) {
        return i.reply({ content: "❌ Você não tem permissão para usar /stock.", ephemeral: true });
      }

      const q = i.options.getInteger("quantidade", true);
      const state = readStockState();
      const next = Math.max(0, state.stock + q);

      writeStockState({
        stock: next,
        panelMessageId: state.panelMessageId,
        panelChannelId: state.panelChannelId
      });

      await updatePanelIfExists().catch(() => null);

      return i.reply({ content: `📦 Stock atualizado: **${formatRobux(next)} Robux**`, ephemeral: true });
    }

    // /logs: registra + dá cargo + fecha + desconta stock (se for robux)
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
      if (!order) {
        return i.editReply("❌ Não achei o pedido nesse ticket (embed do bot).");
      }

      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Total", value: brl(order.total), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Modo", value: order.modo, inline: false },
          { name: "Ticket", value: `${channel}`, inline: false },
          { name: "Staff", value: `<@${i.user.id}>`, inline: false },
        );

      // desconta stock se for Robux (usa robuxNet)
      if (order.type === "robux") {
        embed.addFields(
          { name: "Robux (líquido)", value: `${order.robuxNet}`, inline: true },
          { name: "Robux para comprar", value: `${order.robuxGross}`, inline: true },
        );

        const state = readStockState();
        const nextStock = Math.max(0, state.stock - order.robuxNet);

        writeStockState({
          stock: nextStock,
          panelMessageId: state.panelMessageId,
          panelChannelId: state.panelChannelId
        });

        await updatePanelIfExists().catch(() => null);
      }

      if (logChannel && logChannel.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: "⚠️ Canal de logs inválido/sem permissão.", embeds: [embed] });
      }

      // Dá cargo comprador
      let buyerAdded = false;
      try {
        const member = await i.guild.members.fetch(ownerId);
        if (member && !member.roles.cache.has(BUYER_ROLE_ID)) {
          await member.roles.add(BUYER_ROLE_ID, "Compra registrada via /logs");
        }
        buyerAdded = true;
      } catch (err) {
        console.error("ERRO ao adicionar cargo Comprador:", err);
      }

      await channel.send(
        `✅ Venda registrada por <@${i.user.id}>.\n` +
        `🏷️ Cargo **Comprador** ${buyerAdded ? "aplicado" : "NÃO aplicado (verifique hierarquia/permissões)"} para <@${ownerId}>.\n` +
        `🔒 Ticket será fechado em 5 segundos...`
      );

      await i.editReply("✅ Log registrado. Fechando ticket...");
      await finalizeTicket(channel, "Venda finalizada via /logs");
      return;
    }

    // ---------- Main panel buttons ----------
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

    if (i.isButton() && i.customId === "send_gamepass") {
      // Agora: Nick + LINK (bot tenta ler nome+robux e calcula total)
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
        new ActionRowBuilder().addComponents(link),
      );

      return i.showModal(modal);
    }

    // ---------- Robux mode select -> modal ----------
    if (i.isStringSelectMenu() && i.customId === "robux_mode") {
      const mode = i.values[0]; // no_tax | with_tax

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
        .setLabel("Robux que você quer RECEBER (líquido)")
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
        .setTitle(withTax ? "Calculadora (Com taxa Roblox)" : "Calculadora (Sem taxa)");

      const robux = new TextInputBuilder()
        .setCustomId("robux")
        .setLabel("Robux (valor líquido desejado)")
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
      const robuxNet = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robuxNet) || robuxNet <= 0) {
        return i.editReply("❌ Quantidade inválida.");
      }

      // ✅ Correção: no modo com taxa, calcula robux para comprar (gross)
      const robuxGross = withTax ? requiredRobuxToCoverFee(robuxNet) : robuxNet;

      // Total em R$ baseado no Robux que será comprado (gross)
      const total = round2(priceBRLFromRobux(robuxGross));

      let ticket, openedAt;
      try {
        const res = await createTicketChannel(i.guild, i.user);
        ticket = res.channel;
        openedAt = res.openedAt;
      } catch (err) {
        console.error("ERRO criando ticket:", err);
        return i.editReply(
          "❌ Não consegui criar o canal do ticket.\n" +
          "Verifique se o bot tem **Gerenciar canais** e acesso à categoria.\n" +
          `Erro: \`${err?.message || "desconhecido"}\``
        );
      }

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧾 Novo pedido de Robux")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Robux (líquido):** ${robuxNet}`,
            `**Modo:** ${withTax ? "Com taxa (cobrir 30% Roblox)" : "Sem taxa"}`,
            `**Robux para comprar:** ${robuxGross}`,
            `**Total:** ${brl(total)}`,
            "",
            "📌 **Instruções:**",
            `1) Crie uma **Gamepass de ${robuxGross} Robux**`,
            "2) Envie o link aqui no ticket",
            "",
            "⏳ **Aguarde até 1 dia (24h)**. Após esse tempo o ticket será fechado automaticamente.",
            "",
            "✅ Quando finalizar a venda, o staff usa **/logs** para registrar, dar cargo e fechar.",
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

    // ---------- Submit: Gamepass in-game -> ticket (lê link e calcula) ----------
    if (i.isModalSubmit() && i.customId === "gamepass_modal") {
      await i.deferReply({ ephemeral: true });

      const nick = i.fields.getTextInputValue("nick").trim();
      const gplink = i.fields.getTextInputValue("gplink").trim();

      const gpId = extractGamepassId(gplink);
      if (!gpId) {
        return i.editReply("❌ Link inválido. Envie um link Roblox no formato **/game-pass/ID/**");
      }

      const info = await fetchGamepassInfo(gpId);
      if (!info) {
        // tentativa falhou (Roblox bloqueou, caiu, etc.)
        return i.editReply("❌ Não consegui ler essa Gamepass agora. Tente novamente.");
      }

      const gpName = info.name;
      const gpRobux = info.price;
      const total = round2(priceBRLFromRobux(gpRobux));

      let ticket, openedAt;
      try {
        const res = await createTicketChannel(i.guild, i.user);
        ticket = res.channel;
        openedAt = res.openedAt;
      } catch (err) {
        console.error("ERRO criando ticket:", err);
        return i.editReply(
          "❌ Não consegui criar o canal do ticket.\n" +
          "Verifique se o bot tem **Gerenciar canais** e acesso à categoria.\n" +
          `Erro: \`${err?.message || "desconhecido"}\``
        );
      }

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🎮 Pedido de Gamepass (in-game)")
        .setDescription(
          [
            `**Cliente:** <@${i.user.id}>`,
            `**Nick:** ${nick}`,
            `**Gamepass:** ${gpName}`,
            `**Robux:** ${gpRobux}`,
            `**Total:** ${brl(total)}`,
            `**Link:** ${gplink}`,
            "",
            "⏳ **Aguarde até 1 dia (24h)**. Após esse tempo o ticket será fechado automaticamente.",
            "",
            "✅ Quando finalizar a venda, o staff pode usar **/logs** (registra e fecha).",
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
      const mode = i.customId.split(":")[1]; // with | no
      const withTax = mode === "with";

      const robuxRaw = i.fields.getTextInputValue("robux").trim();
      const robuxNet = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robuxNet) || robuxNet <= 0) {
        return i.reply({ content: "❌ Quantidade inválida.", ephemeral: true });
      }

      const robuxGross = withTax ? requiredRobuxToCoverFee(robuxNet) : robuxNet;
      const total = round2(priceBRLFromRobux(robuxGross));

      // ✅ Agora manda SÓ um valor (não os dois juntos)
      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧮 Resultado da calculadora")
        .setDescription(
          [
            `**Robux (líquido desejado):** ${robuxNet}`,
            withTax ? `**Robux para comprar (c/ taxa 30%):** ${robuxGross}` : null,
            `**Total:** ${brl(total)}`,
          ].filter(Boolean).join("\n")
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