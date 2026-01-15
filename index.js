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

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID; // cargo a marcar
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null; // categoria (opcional)

// ====== PRICING ======
const RATE_PER_1000 = 28;
const PRICE_MULT = 1.30; // +30% no preço (modo com taxa)
const PURPLE = 0x7c3aed;

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

// ====== COMMANDS ======
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("cmd")
      .setDescription("Envia o painel de compra de Robux")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /cmd registrado");
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
  const safeName = user.username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12) || "user";

  const channelName = `ticket-${safeName}-${user.discriminator ?? "0000"}`;

  // Permissões: só o usuário + staff + bot veem
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

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
  });

  return channel;
}

client.on("interactionCreate", async (i) => {
  try {
    // /cmd
    if (i.isChatInputCommand() && i.commandName === "cmd") {
      await sendPanel(i.channel);
      return i.reply({ content: "✅ Painel enviado.", ephemeral: true });
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

    // enviou modal -> cria ticket + posta infos + marca staff
    if (i.isModalSubmit() && i.customId.startsWith("order:")) {
      const mode = i.customId.split(":")[1];
      const withTax = mode === "with_tax";

      const nick = i.fields.getTextInputValue("nick").trim();
      const robuxRaw = i.fields.getTextInputValue("robux").trim();
      const robux = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) {
        return i.reply({ content: "❌ Quantidade inválida.", ephemeral: true });
      }

      const total = round2(priceBRL(robux, withTax));

      // Cria canal
      const ticket = await createTicketChannel(i.guild, i.user);

      // Mensagem no ticket
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
            "3) Aguarde a confirmação",
          ].join("\n")
        );

      await ticket.send({
        content: `<@&${STAFF_ROLE_ID}> Novo pedido!`, // marca o cargo
        embeds: [embed],
      });

      // Resposta pro usuário (ephemeral)
      return i.reply({
        content: `✅ Ticket criado: ${ticket}`,
        ephemeral: true,
      });
    }
  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      try { await i.reply({ content: "❌ Erro. Veja os logs.", ephemeral: true }); } catch {}
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();