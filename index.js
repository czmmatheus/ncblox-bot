const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");

const fetch = require("node-fetch"); // v2
const cheerio = require("cheerio");

/* =======================
   CONFIG (Railway ENV)
======================= */
const CFG = {
  TOKEN: process.env.BOT_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,

  STAFF_ROLE_ID: process.env.STAFF_ROLE_ID,
  TICKET_CATEGORY_ID: process.env.TICKET_CATEGORY_ID || null,

  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || "1461273267225497754",
  BUYER_ROLE_ID: process.env.BUYER_ROLE_ID || "1459480515408171217",

  RATE_PER_1000: 28,
  PRICE_MULT: 1.3, // +30% no preço (só para Robux com taxa)
  PURPLE: 0x7c3aed,

  AUTO_CLOSE_MS: 24 * 60 * 60 * 1000, // 24h
  BANNER_URL:
    process.env.BANNER_URL ||
    "https://cdn.discordapp.com/attachments/1428217284660564125/1461373724535029893/file_000000007a1471f6bb88daa791749f60.png?ex=696a51d6&is=69690056&hm=d85d13d5a32d0c1df315724e18a5d0d6817ae91ccf4a9e27a35c27a41c966400&",
};

for (const k of ["TOKEN", "CLIENT_ID", "GUILD_ID", "STAFF_ROLE_ID"]) {
  if (!CFG[k]) {
    console.error(`Falta variável obrigatória: ${k === "TOKEN" ? "BOT_TOKEN" : k}`);
    process.exit(1);
  }
}

const BRAND = "𝗡𝗖 𝗕𝗟𝗢𝗫";

/* =======================
   CLIENT (precisa MessageContent)
======================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* =======================
   HELPERS
======================= */
const ticketTimers = new Map();

const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round2 = (n) => Math.round(n * 100) / 100;

const ddmmyy = (d = new Date()) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
};

const hasStaff = (member) => member?.roles?.cache?.has(CFG.STAFF_ROLE_ID);
const ownerFromTopic = (topic = "") => topic.match(/ticketOwner:(\d+)/)?.[1] || null;

const priceRobuxBRL = (robux, withTax) => {
  const base = (robux / 1000) * CFG.RATE_PER_1000;
  return withTax ? base * CFG.PRICE_MULT : base;
};

function cancelAutoClose(channelId) {
  const t = ticketTimers.get(channelId);
  if (t) clearTimeout(t);
  ticketTimers.delete(channelId);
}

async function deleteTicket(channel, reason = "Closed") {
  cancelAutoClose(channel.id);
  setTimeout(() => channel.delete(reason).catch(() => {}), 5000);
}

async function scheduleAutoClose(channel, openedAt) {
  cancelAutoClose(channel.id);
  const left = Math.max(0, openedAt + CFG.AUTO_CLOSE_MS - Date.now());

  const t = setTimeout(async () => {
    try {
      await channel.send("⏳ Ticket encerrado automaticamente após **24 horas**.");
    } catch {}
    await deleteTicket(channel, "Auto-close 24h");
  }, left);

  ticketTimers.set(channel.id, t);
}

/* =======================
   EMBEDS / PANELS
======================= */
function mainPanelEmbed() {
  return new EmbedBuilder()
    .setColor(CFG.PURPLE)
    .setTitle(BRAND)
    .setDescription(
      [
        "💎 **Loja oficial 𝗡𝗖 𝗕𝗟𝗢𝗫**",
        "",
        "• Entrega rápida via **Gamepass**",
        "• Suporte pelo **sistema de tickets**",
        "• Pagamento seguro",
        "",
        "💰 **Tabela de valores (Robux)**",
        `• Sem taxa → **1000 = ${brl(CFG.RATE_PER_1000)}**`,
        `• Com taxa (+30%) → **1000 = ${brl(CFG.RATE_PER_1000 * CFG.PRICE_MULT)}**`,
        "",
        "Clique em um botão abaixo para iniciar seu pedido 👇",
      ].join("\n")
    )
    .setImage(CFG.BANNER_URL);
}

function calcPanelEmbed() {
  return new EmbedBuilder()
    .setColor(CFG.PURPLE)
    .setTitle(BRAND)
    .setDescription(
      [
        "**Calculadora de Robux**",
        "",
        `Base: **1000 Robux = ${brl(CFG.RATE_PER_1000)}**`,
        "Com taxa: **+30% no preço**",
        "",
        "Clique em um botão para calcular:",
      ].join("\n")
    )
    .setImage(CFG.BANNER_URL);
}

function ticketButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Fechar ticket").setStyle(ButtonStyle.Danger)
  );
}

/* =======================
   TICKET CREATE
======================= */
async function createTicket(guild, user) {
  const safe = (user.username || "user").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  const name = `ticket-${safe}-${String(user.id).slice(-4)}`;
  const openedAt = Date.now();

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
      id: CFG.STAFF_ROLE_ID,
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

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: CFG.TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
    topic: `ticketOwner:${user.id} openedAt:${openedAt}`,
  });

  await scheduleAutoClose(channel, openedAt);
  return channel;
}

/* =======================
   /logs - extrair pedido de Robux do embed do bot
======================= */
async function extractRobuxOrder(channel) {
  const msgs = await channel.messages.fetch({ limit: 50 });

  for (const [, msg] of msgs) {
    if (msg.author?.id !== client.user.id) continue;
    if (!msg.embeds?.length) continue;

    const e = msg.embeds[0];
    const title = (e.title || "").toLowerCase();
    const desc = e.description || "";

    if (!title.includes("novo pedido de robux")) continue;

    const robux = Number(desc.match(/\*\*Robux:\*\*\s*(\d+)/i)?.[1] || 0);
    const totalStr = desc.match(/\*\*Total:\*\*\s*R\$\s*([0-9.,]+)/i)?.[1];
    const modo = (desc.match(/\*\*Modo:\*\*\s*(.+)/i)?.[1] || "—").split("\n")[0].trim();

    if (!robux || !totalStr) continue;

    const total = Number(totalStr.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(total) || total <= 0) continue;

    return { robux, total: round2(total), modo };
  }
  return null;
}

/* =======================
   /gmp - achar link em texto OU embed
======================= */
function extractGamepassUrlFromText(text = "") {
  return (
    text.match(/https?:\/\/www\.roblox\.com\/pt\/game-pass\/\d+\/[^\s]+/i)?.[0] ||
    text.match(/https?:\/\/www\.roblox\.com\/game-pass\/\d+\/[^\s]+/i)?.[0] ||
    null
  );
}

async function findLastGamepassLink(channel) {
  const msgs = await channel.messages.fetch({ limit: 50 });

  for (const [, m] of msgs) {
    // texto normal
    const inContent = extractGamepassUrlFromText(m.content || "");
    if (inContent) return inContent;

    // embeds (onde seu bot coloca "Gamepass: link")
    if (m.embeds?.length) {
      for (const e of m.embeds) {
        const t = `${e.title || ""}\n${e.description || ""}`;
        const inEmbed = extractGamepassUrlFromText(t);
        if (inEmbed) return inEmbed;
      }
    }
  }
  return null;
}

async function getGamepassNameAndRobux(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error("Falha ao abrir a página da Gamepass");

  const html = await res.text();
  const $ = cheerio.load(html);

  const name =
    $("h1").first().text().trim() ||
    $("meta[property='og:title']").attr("content") ||
    "Gamepass";

  const text = $.text();
  const m = text.match(/(\d{1,6})\s*Robux/i);
  if (!m) throw new Error("Não achei o valor em Robux na página");

  const robux = Number(m[1]);
  if (!Number.isFinite(robux) || robux <= 0) throw new Error("Robux inválido");

  return { name, robux };
}

/* =======================
   COMMANDS REGISTER
======================= */
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("cmd").setDescription("Painel principal (vendas)"),
    new SlashCommandBuilder().setName("2cmd").setDescription("Painel da calculadora"),
    new SlashCommandBuilder().setName("logs").setDescription("Finaliza ticket de Robux (staff)"),
    new SlashCommandBuilder().setName("gmp").setDescription("Finaliza ticket de Gamepass (staff)"),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(CFG.TOKEN);
  await rest.put(Routes.applicationGuildCommands(CFG.CLIENT_ID, CFG.GUILD_ID), { body: commands });
  console.log("✅ Slash commands registrados");
}

/* =======================
   READY
======================= */
client.once("ready", () => {
  console.log(`✅ Online como ${client.user.tag}`);
});

/* =======================
   INTERACTIONS
======================= */
client.on("interactionCreate", async (i) => {
  try {
    /* ---------- Slash Commands ---------- */
    if (i.isChatInputCommand()) {
      // /cmd
      if (i.commandName === "cmd") {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("buy_robux").setLabel("Comprar Robux").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("send_gamepass").setLabel("Enviar Gamepass (in-game)").setStyle(ButtonStyle.Secondary)
        );

        await i.channel.send({ embeds: [mainPanelEmbed()], components: [row] });
        return i.reply({ content: "✅ Painel enviado.", ephemeral: true });
      }

      // /2cmd
      if (i.commandName === "2cmd") {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("calc_no_tax").setLabel("Calcular (Sem taxa)").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("calc_with_tax").setLabel("Calcular (Com taxa)").setStyle(ButtonStyle.Primary)
        );

        await i.channel.send({ embeds: [calcPanelEmbed()], components: [row] });
        return i.reply({ content: "✅ Painel da calculadora enviado.", ephemeral: true });
      }

      // /logs (Robux)
      if (i.commandName === "logs") {
        if (!hasStaff(i.member)) return i.reply({ content: "❌ Sem permissão.", ephemeral: true });

        const ownerId = ownerFromTopic(i.channel?.topic || "");
        if (!ownerId) return i.reply({ content: "❌ Use /logs dentro de um ticket.", ephemeral: true });

        await i.deferReply({ ephemeral: true });

        const order = await extractRobuxOrder(i.channel);
        if (!order) return i.editReply("❌ Não encontrei pedido de Robux nesse ticket.");

        const logCh = await i.guild.channels.fetch(CFG.LOG_CHANNEL_ID).catch(() => null);

        const embed = new EmbedBuilder()
          .setColor(CFG.PURPLE)
          .setTitle(`📌 Venda registrada — ${BRAND}`)
          .addFields(
            { name: "Usuário", value: `<@${ownerId}>`, inline: true },
            { name: "Robux", value: `${order.robux}`, inline: true },
            { name: "Total", value: brl(order.total), inline: true },
            { name: "Data", value: ddmmyy(), inline: true },
            { name: "Modo", value: order.modo, inline: false },
            { name: "Ticket", value: `${i.channel}`, inline: false },
            { name: "Staff", value: `<@${i.user.id}>`, inline: false }
          );

        if (logCh?.isTextBased()) await logCh.send({ embeds: [embed] });

        // cargo comprador + fechar
        try {
          const member = await i.guild.members.fetch(ownerId);
          if (!member.roles.cache.has(CFG.BUYER_ROLE_ID)) await member.roles.add(CFG.BUYER_ROLE_ID);
        } catch {}

        await i.channel.send("✅ Venda registrada. 🔒 Fechando ticket em 5s…");
        await i.editReply("✅ OK.");
        return deleteTicket(i.channel, "Finalizado via /logs");
      }

      // /gmp (Gamepass)
      if (i.commandName === "gmp") {
        if (!hasStaff(i.member)) return i.reply({ content: "❌ Sem permissão.", ephemeral: true });

        const ownerId = ownerFromTopic(i.channel?.topic || "");
        if (!ownerId) return i.reply({ content: "❌ Use /gmp dentro de um ticket.", ephemeral: true });

        await i.deferReply({ ephemeral: true });

        // ⭐ agora acha no embed também
        const link = await findLastGamepassLink(i.channel);
        if (!link) return i.editReply("❌ Não achei link de Gamepass no ticket (nem em mensagens nem em embeds).");

        const { name, robux } = await getGamepassNameAndRobux(link);
        const total = round2((robux / 1000) * CFG.RATE_PER_1000); // SEM TAXA em gamepass

        const logCh = await i.guild.channels.fetch(CFG.LOG_CHANNEL_ID).catch(() => null);

        const embed = new EmbedBuilder()
          .setColor(CFG.PURPLE)
          .setTitle(`📌 Gamepass registrada — ${BRAND}`)
          .setDescription(
            [
              `**${name} — ${robux} Robux**`,
              `💰 **${brl(total)}**`,
              `🔗 ${link}`,
              `📅 ${ddmmyy()}`,
              `👤 Cliente: <@${ownerId}>`,
              `🧰 Staff: <@${i.user.id}>`,
              `📁 Ticket: ${i.channel}`,
            ].join("\n")
          );

        if (logCh?.isTextBased()) await logCh.send({ embeds: [embed] });

        // cargo comprador + fechar
        try {
          const member = await i.guild.members.fetch(ownerId);
          if (!member.roles.cache.has(CFG.BUYER_ROLE_ID)) await member.roles.add(CFG.BUYER_ROLE_ID);
        } catch {}

        await i.channel.send("✅ Gamepass registrada. 🔒 Fechando ticket em 5s…");
        await i.editReply("✅ OK.");
        return deleteTicket(i.channel, "Finalizado via /gmp");
      }
    }

    /* ---------- Buttons ---------- */
    if (i.isButton()) {
      if (i.customId === "buy_robux") {
        const menu = new StringSelectMenuBuilder()
          .setCustomId("robux_mode")
          .setPlaceholder("Escolha o modo")
          .addOptions(
            { label: "Sem taxa", value: "no_tax" },
            { label: "Com taxa (+30% no preço)", value: "with_tax" }
          );

        return i.reply({
          content: "Escolha uma opção:",
          components: [new ActionRowBuilder().addComponents(menu)],
          ephemeral: true,
        });
      }

      if (i.customId === "send_gamepass") {
        const modal = new ModalBuilder().setCustomId("gp_modal").setTitle("Enviar Gamepass (in-game)");

        const nick = new TextInputBuilder()
          .setCustomId("nick")
          .setLabel("Nick do Roblox")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const link = new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Link da Gamepass (Roblox)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nick),
          new ActionRowBuilder().addComponents(link)
        );

        return i.showModal(modal);
      }

      if (i.customId === "calc_no_tax" || i.customId === "calc_with_tax") {
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

      if (i.customId === "close_ticket") {
        const ownerId = ownerFromTopic(i.channel?.topic || "");
        const canClose = hasStaff(i.member) || (ownerId && i.user.id === ownerId);

        if (!canClose) return i.reply({ content: "❌ Você não pode fechar este ticket.", ephemeral: true });

        await i.reply({ content: "🔒 Fechando ticket em 5s…", ephemeral: true });
        return deleteTicket(i.channel, "Fechado manualmente");
      }
    }

    /* ---------- Select Menu ---------- */
    if (i.isStringSelectMenu() && i.customId === "robux_mode") {
      const mode = i.values[0]; // no_tax | with_tax

      const modal = new ModalBuilder().setCustomId(`robux_modal:${mode}`).setTitle("Pedido de Robux");

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

    /* ---------- Modals ---------- */
    if (i.isModalSubmit()) {
      if (i.customId.startsWith("calc_modal:")) {
        const withTax = i.customId.endsWith(":with");
        const robux = Number(i.fields.getTextInputValue("robux").replace(/[^\d]/g, ""));

        if (!Number.isFinite(robux) || robux <= 0) return i.reply({ content: "❌ Robux inválido.", ephemeral: true });

        const total = round2(priceRobuxBRL(robux, withTax));

        const embed = new EmbedBuilder()
          .setColor(CFG.PURPLE)
          .setTitle(`🧮 Resultado — ${BRAND}`)
          .setDescription(
            [
              `**Robux:** ${robux}`,
              `**Base:** 1000 = ${brl(CFG.RATE_PER_1000)}`,
              "",
              withTax ? `**Com taxa (+30%)** → ${brl(total)}` : `**Sem taxa** → ${brl(total)}`,
            ].join("\n")
          );

        return i.reply({ embeds: [embed], ephemeral: true });
      }

      if (i.customId.startsWith("robux_modal:")) {
        await i.deferReply({ ephemeral: true });

        const mode = i.customId.split(":")[1];
        const withTax = mode === "with_tax";

        const nick = i.fields.getTextInputValue("nick").trim();
        const robux = Number(i.fields.getTextInputValue("robux").replace(/[^\d]/g, ""));

        if (!Number.isFinite(robux) || robux <= 0) return i.editReply("❌ Robux inválido.");

        const total = round2(priceRobuxBRL(robux, withTax));
        const ticket = await createTicket(i.guild, i.user);

        const embed = new EmbedBuilder()
          .setColor(CFG.PURPLE)
          .setTitle("🧾 Novo pedido de Robux")
          .setDescription(
            [
              `**Cliente:** <@${i.user.id}>`,
              `**Nick:** ${nick}`,
              `**Robux:** ${robux}`,
              `**Modo:** ${withTax ? "Com taxa (+30% no preço)" : "Sem taxa"}`,
              `**Total:** ${brl(total)}`,
              "",
              "⏳ Aguarde até **1 dia (24h)**. Após esse tempo o ticket fecha automaticamente.",
              "",
              "✅ Ao finalizar: staff usa **/logs** (registra, dá cargo e fecha).",
            ].join("\n")
          );

        await ticket.send({
          content: `<@&${CFG.STAFF_ROLE_ID}> Novo pedido!`,
          embeds: [embed],
          components: [ticketButtonsRow()],
        });

        return i.editReply(`✅ Ticket criado: ${ticket}`);
      }

      if (i.customId === "gp_modal") {
        await i.deferReply({ ephemeral: true });

        const nick = i.fields.getTextInputValue("nick").trim();
        const link = i.fields.getTextInputValue("link").trim();
        const ticket = await createTicket(i.guild, i.user);

        const embed = new EmbedBuilder()
          .setColor(CFG.PURPLE)
          .setTitle("🎮 Pedido de Gamepass (in-game)")
          .setDescription(
            [
              `**Cliente:** <@${i.user.id}>`,
              `**Nick:** ${nick}`,
              `**Gamepass:** ${link}`,
              "",
              "⏳ Aguarde até **1 dia (24h)**. Após esse tempo o ticket fecha automaticamente.",
              "",
              "✅ Ao finalizar: staff usa **/gmp** (lê o link, calcula e registra).",
            ].join("\n")
          );

        await ticket.send({
          content: `<@&${CFG.STAFF_ROLE_ID}> Novo pedido (Gamepass)!`,
          embeds: [embed],
          components: [ticketButtonsRow()],
        });

        return i.editReply(`✅ Ticket criado: ${ticket}`);
      }
    }
  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      try {
        await i.reply({ content: "❌ Erro. Veja os logs do Railway.", ephemeral: true });
      } catch {}
    }
  }
});

/* =======================
   START
======================= */
(async () => {
  await registerCommands();
  await client.login(CFG.TOKEN);
})();