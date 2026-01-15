// index.js
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
} = require("discord.js");

// ====== CONFIG ======
const TOKEN = process.env.BOT_TOKEN;       // coloque no .env ou no host
const CLIENT_ID = process.env.CLIENT_ID;   // ID do aplicativo
const GUILD_ID = process.env.GUILD_ID;     // ID do servidor

const RATE_PER_1000 = 28;     // R$ 28 por 1000
const PRICE_MULT = 1.30;      // +30% no preço (modo "com taxa")
const PURPLE = 0x7c3aed;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltam variáveis de ambiente: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

function brl(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function priceBRL(robux, withTax) {
  const base = (robux / 1000) * RATE_PER_1000;
  return withTax ? base * PRICE_MULT : base;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("cmd")
      .setDescription("Envia o painel de compra de Robux")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ /painel registrado");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => console.log(`✅ Logado como ${client.user.tag}`));

async function sendPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("Painel de Compra - Robux")
    .setDescription(
      [
        `• **Sem taxa:** 1000 = ${brl(RATE_PER_1000)}`,
        `• **Com taxa (+30% no preço):** 1000 = ${brl(RATE_PER_1000 * PRICE_MULT)}`,
        "",
        "Clique em **Comprar** para calcular e receber instruções."
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy")
      .setLabel("Comprar")
      .setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

client.on("interactionCreate", async (i) => {
  try {
    // /painel
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

    // selecionou modo => abre modal
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
        new ActionRowBuilder().addComponents(robux),
      );

      return i.showModal(modal);
    }

    // enviou modal => calcula
    if (i.isModalSubmit() && i.customId.startsWith("order:")) {
      const mode = i.customId.split(":")[1];
      const withTax = mode === "with_tax";

      const nick = i.fields.getTextInputValue("nick").trim();
      const robuxRaw = i.fields.getTextInputValue("robux").trim();
      const robux = Number(robuxRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robux) || robux <= 0) {
        return i.reply({ content: "❌ Quantidade inválida.", ephemeral: true });
      }

      const total = priceBRL(robux, withTax);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("✅ Pedido calculado")
        .setDescription(
          [
            `**Nick:** ${nick}`,
            `**Robux:** ${robux}`,
            `**Modo:** ${withTax ? "Com taxa (+30% no preço)" : "Sem taxa"}`,
            `**Total:** ${brl(Math.round(total * 100) / 100)}`,
            "",
            "📌 **Instrução:**",
            `Crie uma gamepass de **${robux} Robux** e envie o link.`,
          ].join("\n")
        );

      return i.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (e) {
    console.error(e);
    if (i.isRepliable()) {
      try { await i.reply({ content: "❌ Erro no bot. Veja o console.", ephemeral: true }); } catch {}
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();