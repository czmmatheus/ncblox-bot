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

// ====== ENV ======
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID; // cargo a marcar + permissão do /logs
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null; // categoria (opcional)

// Canal de logs (você passou esse)
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1461273267225497754";

// ====== PRICING ======
const RATE_PER_1000 = 28;
const PRICE_MULT = 1.30; // +30% no preço (modo com taxa)
const PURPLE = 0x7c3aed;

// ====== AUTO CLOSE ======
const AUTO_CLOSE_MS = 24 * 60 * 60 * 1000; // 24h

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltam variáveis: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}
if (!STAFF_ROLE_ID) {
  console.error("Falta STAFF_ROLE_ID (ID do cargo que será marcado no ticket).");
  process.exit(1);
}

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

// Guarda timers em memória (não quebra nada; só não sobrevive a restart)
const ticketTimers = new Map(); // channelId -> timeout

// ====== COMMANDS ======
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("cmd")
      .setDescription("Envia o painel de compra de Robux"),
    new SlashCommandBuilder()
      .setName("logs")
      .setDescription("Registra uma venda (use dentro do ticket)")
      .addNumberOption(opt =>
        opt.setName("valor")
          .setDescription("Valor da venda em reais (ex: 50)")
          .setRequired(true)
      ),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /cmd e /logs registrados");
}

// ====== BOT ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => console.log(`✅ Logado como ${client.user.tag}`));

async function sendPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("Central de pedidos - Robux")
    .setDescription(
      [
        `• **Sem taxa:** 1000 = ${brl(RATE_PER_1000)}`,
        `• **Com taxa (+30% no preço):** 1000 = ${brl(RATE_PER_1000 * PRICE_MULT)}`,
        "",
        "Clique em **Comprar** para abrir um ticket com seu pedido.",
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy")
      .setLabel("Comprar")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function createTicketChannel(guild, user) {
  const safeName = (user.username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12) || "user";

  const channelName = `ticket-${safeName}-${user.id.toString().slice(-4)}`;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
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

  // Topic guarda o dono + timestamp (ajuda em /logs e auditoria)
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
  // cancela timer anterior se existir
  if (ticketTimers.has(channel.id)) clearTimeout(ticketTimers.get(channel.id));

  const msLeft = Math.max(0, (openedAt + AUTO_CLOSE_MS) - Date.now());

  const t = setTimeout(async () => {
    try {
      if (!channel || !channel.guild) return;
      // se o canal ainda existir:
      await channel.send("⏳ Ticket encerrado automaticamente após **24 horas**.");
      setTimeout(async () => {
        try { await channel.delete("Auto-close 24h"); } catch {}
      }, 5000);
    } catch {}
    ticketTimers.delete(channel.id);
  }, msLeft);

  ticketTimers.set(channel.id, t);
}

function buildCloseRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Fechar ticket")
      .setStyle(ButtonStyle.Danger)
  );
}

client.on("interactionCreate", async (i) => {
  try {
    // /cmd
    if (i.isChatInputCommand() && i.commandName === "cmd") {
      await sendPanel(i.channel);
      return i.reply({ content: "✅ Painel enviado.", ephemeral: true });
    }

    // /logs <valor>
    if (i.isChatInputCommand() && i.commandName === "logs") {
      // Só staff
      if (!hasStaffRole(i.member)) {
        return i.reply({ content: "❌ Você não tem permissão para usar /logs.", ephemeral: true });
      }

      const valor = i.options.getNumber("valor", true);
      if (!Number.isFinite(valor) || valor <= 0) {
        return i.reply({ content: "❌ Valor inválido.", ephemeral: true });
      }

      const channel = i.channel;
      const topic = channel?.topic || "";
      const m = topic.match(/ticketOwner:(\d+)/);
      const ownerId = m?.[1];

      if (!ownerId) {
        return i.reply({
          content: "❌ Não achei o dono do ticket (topic sem ticketOwner). Use /logs dentro de um ticket criado pelo bot.",
          ephemeral: true,
        });
      }

      const dateStr = formatDateDDMMYY(new Date());
      const logChannel = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("📌 Venda registrada")
        .addFields(
          { name: "Usuário", value: `<@${ownerId}>`, inline: true },
          { name: "Valor", value: brl(round2(valor)), inline: true },
          { name: "Data", value: dateStr, inline: true },
          { name: "Ticket", value: `${channel}`, inline: false },
          { name: "Registrado por", value: `<@${i.user.id}>`, inline: false },
        );

      // Confirma no ticket
      await i.reply({ content: "✅ Venda registrada.", ephemeral: true });

      // Envia no canal de logs
      if (logChannel && logChannel.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      } else {
        // se o canal de logs não existe/sem permissão, pelo menos posta no ticket
        await channel.send({ content: "⚠️ Não consegui enviar no canal de logs. Verifique LOG_CHANNEL_ID/permissões.", embeds: [embed] });
      }

      return;
    }

    // botão comprar
    if (i.isButton() && i.customId === "buy") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("mode")
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

    // escolheu modo -> modal
    if (i.isStringSelectMenu() && i.customId === "mode") {
      const mode = i.values[0]; // no_tax | with_tax

      const modal = new ModalBuilder()
        .setCustomId(`order:${mode}`)
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

    // enviou modal -> cria ticket + posta infos + marca staff + botão fechar + auto-close 24h
    if (i.isModalSubmit() && i.customId.startsWith("order:")) {
      await i.deferReply({ ephemeral: true }); // evita "Interaction failed"

      const mode = i.customId.split(":")[1];
      const withTax = mode === "with_tax";

      const nick = i.fields.getTextInputValue("nick").trim();
      const robuxRaw = i.fields.getTextInputValue("robux").trim();
      const robux = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) {
        return i.editReply({ content: "❌ Quantidade inválida." });
      }

      const total = round2(priceBRL(robux, withTax));

      // Cria canal
      let ticket, openedAt;
      try {
        const res = await createTicketChannel(i.guild, i.user);
        ticket = res.channel;
        openedAt = res.openedAt;
      } catch (err) {
        console.error("ERRO criando ticket:", err);
        return i.editReply({
          content:
            "❌ Não consegui criar o canal do ticket.\n" +
            "Verifique se o bot tem **Gerenciar canais** e acesso à categoria.\n" +
            `Erro: \`${err?.message || "desconhecido"}\``,
        });
      }

      // Mensagem no ticket + botão fechar
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
            "⏳ **Aguarde até 1 dia (24h)**. Após esse tempo o ticket será fechado automaticamente.",
          ].join("\n")
        );

      await ticket.send({
        content: `<@&${STAFF_ROLE_ID}> Novo pedido!`,
        embeds: [embed],
        components: [buildCloseRow()],
      });

      // agenda auto-close em 24h
      await scheduleAutoClose(ticket, openedAt);

      // Resposta pro usuário
      return i.editReply({ content: `✅ Ticket criado: ${ticket}` });
    }

    // botão fechar ticket
    if (i.isButton() && i.customId === "close_ticket") {
      const channel = i.channel;

      // Permissão: staff OU dono do ticket
      const topic = channel?.topic || "";
      const m = topic.match(/ticketOwner:(\d+)/);
      const ownerId = m?.[1];

      const isOwner = ownerId && i.user.id === ownerId;
      const isStaff = hasStaffRole(i.member);

      if (!isOwner && !isStaff) {
        return i.reply({ content: "❌ Você não pode fechar este ticket.", ephemeral: true });
      }

      await i.reply({ content: "🔒 Fechando ticket em 5 segundos...", ephemeral: true });

      // cancela timer
      if (ticketTimers.has(channel.id)) {
        clearTimeout(ticketTimers.get(channel.id));
        ticketTimers.delete(channel.id);
      }

      setTimeout(async () => {
        try { await channel.delete("Ticket fechado"); } catch {}
      }, 5000);

      return;
    }

  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      try { await i.reply({ content: "❌ Erro. Veja os logs.", ephemeral: true }); } catch {}
    }
  }
});

// ===== START =====
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();