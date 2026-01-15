/**
 * Discord.js v14 — Painel + Calculadora Robux (taxa Roblox 30% => você recebe 70%)
 *
 * Regras:
 * - Base: 1000 Robux = R$ 28,00
 * - Sem taxa: cliente cria gamepass = X (você recebe 0.7X)
 * - Cobrir taxa: cliente quer X líquido => gamepass = ceil(X / 0.7)
 * - Valor em R$: (gamepassRobux / 1000) * 28
 *
 * Como usar:
 * 1) npm i discord.js
 * 2) node index.js
 * 3) /painel no canal onde quer o painel
 *
 * Ajuste:
 * - TOKEN, CLIENT_ID, GUILD_ID
 * - (Opcional) IMAGEM do embed
 */

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
} = require("discord.js");

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN || "COLOQUE_SEU_TOKEN_AQUI";
const CLIENT_ID = process.env.CLIENT_ID || "COLOQUE_SEU_CLIENT_ID_AQUI";
const GUILD_ID = process.env.GUILD_ID || "COLOQUE_SEU_GUILD_ID_AQUI";

const RATE_PER_1000 = 28; // R$ por 1000 Robux
const ROBLOX_NET = 0.7; // você recebe 70%
const PURPLE = 0x7c3aed;
const PANEL_IMAGE_URL = "https://example.com/banner.png"; // troque ou deixe vazio

// ===== HELPERS =====
function ceilInt(n) {
  return Math.ceil(n);
}
function brl(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function priceFromRobux(robux) {
  return (robux / 1000) * RATE_PER_1000;
}
function gpToNetTarget(netRobuxWanted) {
  return ceilInt(netRobuxWanted / ROBLOX_NET);
}
function netFromGp(gpRobux) {
  return Math.floor(gpRobux * ROBLOX_NET);
}

// ===== SLASH COMMAND REGISTER =====
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("painel")
      .setDescription("Envia o painel de compra/calculadora de Robux")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✅ Comandos registrados.");
}

// ===== BOT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
  console.log(`✅ Logado como ${client.user.tag}`);
});

// ===== SEND PANEL =====
async function sendPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("Central de pedidos - Robux")
    .setDescription(
      [
        "• **Tabela:** 1000 Robux = " + brl(RATE_PER_1000),
        "• **Taxa Roblox:** ao comprar gamepass, você recebe **70%** (Roblox retém 30%).",
        "",
        "Use os botões abaixo:",
        "— **Comprar quantia específica**: escolhe modo e informa Nick + Robux.",
        "— **Calcular valores**: mostra exemplo e permite testar valores.",
      ].join("\n")
    );

  if (PANEL_IMAGE_URL && PANEL_IMAGE_URL.startsWith("http")) {
    embed.setImage(PANEL_IMAGE_URL);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy_specific")
      .setLabel("Comprar quantia específica")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("calc_values")
      .setLabel("Calcular valores")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ===== INTERACTIONS =====
client.on("interactionCreate", async (interaction) => {
  try {
    // /painel
    if (interaction.isChatInputCommand() && interaction.commandName === "painel") {
      await sendPanel(interaction.channel);
      return interaction.reply({ content: "✅ Painel enviado.", ephemeral: true });
    }

    // Botão: comprar
    if (interaction.isButton() && interaction.customId === "buy_specific") {
      const select = new StringSelectMenuBuilder()
        .setCustomId("choose_mode")
        .setPlaceholder("Escolha o modo do pedido")
        .addOptions([
          {
            label: "Sem taxa (gamepass normal; você recebe 70%)",
            value: "no_tax",
          },
          {
            label: "Cobrir taxa (você recebe o valor líquido desejado)",
            value: "cover_tax",
          },
        ]);

      const row = new ActionRowBuilder().addComponents(select);

      return interaction.reply({
        content: "Escolha uma opção antes de continuar:",
        components: [row],
        ephemeral: true,
      });
    }

    // Select: modo escolhido -> abre modal
    if (interaction.isStringSelectMenu() && interaction.customId === "choose_mode") {
      const mode = interaction.values[0]; // no_tax | cover_tax

      const modal = new ModalBuilder()
        .setCustomId(`order_modal:${mode}`)
        .setTitle("Pedido de Robux");

      const nick = new TextInputBuilder()
        .setCustomId("nick")
        .setLabel("Nick do Roblox")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const robux = new TextInputBuilder()
        .setCustomId("robux")
        .setLabel(mode === "cover_tax" ? "Robux líquidos desejados" : "Robux da gamepass")
        .setPlaceholder(mode === "cover_tax" ? "Ex: 1000" : "Ex: 1000")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nick),
        new ActionRowBuilder().addComponents(robux)
      );

      return interaction.showModal(modal);
    }

    // Modal submit -> calcula e responde
    if (interaction.isModalSubmit() && interaction.customId.startsWith("order_modal:")) {
      const mode = interaction.customId.split(":")[1];
      const nick = interaction.fields.getTextInputValue("nick").trim();
      const robuxInputRaw = interaction.fields.getTextInputValue("robux").trim();
      const robuxInput = Number(robuxInputRaw.replace(/[^\d]/g, ""));

      if (!Number.isFinite(robuxInput) || robuxInput <= 0) {
        return interaction.reply({ content: "❌ Quantidade inválida.", ephemeral: true });
      }

      let gamepassRobux;
      let netRobux;
      let price;

      if (mode === "no_tax") {
        gamepassRobux = robuxInput;
        netRobux = netFromGp(gamepassRobux);
        price = priceFromRobux(gamepassRobux);
      } else {
        // cover_tax: robuxInput é o líquido desejado
        netRobux = robuxInput;
        gamepassRobux = gpToNetTarget(netRobux);
        price = priceFromRobux(gamepassRobux);
      }

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("✅ Cálculo do pedido")
        .setDescription(
          [
            `**Nick:** ${nick}`,
            `**Modo:** ${mode === "cover_tax" ? "Cobrir taxa (líquido)" : "Sem taxa"}`,
            "",
            `**Gamepass:** ${gamepassRobux} Robux`,
            `**Você recebe:** ${netRobux} Robux${mode === "no_tax" ? " (70% do valor)" : " (líquido)"}`,
            `**Total:** ${brl(round2(price))}`,
            "",
            "**Instrução:**",
            `Crie uma gamepass de **${gamepassRobux} Robux** e envie o link.`,
          ].join("\n")
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Botão: calculadora (mensagem + mini instrução)
    if (interaction.isButton() && interaction.customId === "calc_values") {
      // exemplo para 1000 líquidos e 1000 gamepass
      const gpCover1000 = gpToNetTarget(1000);
      const priceNoTax1000 = priceFromRobux(1000);
      const priceCover1000 = priceFromRobux(gpCover1000);

      const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle("🧮 Calculadora de Robux")
        .setDescription(
          [
            `**Tabela:** 1000 Robux = ${brl(RATE_PER_1000)}`,
            `**Taxa Roblox:** você recebe 70% (Roblox retém 30%).`,
            "",
            "**Exemplo (1000):**",
            `• **Sem taxa:** gamepass 1000 → você recebe 700 → ${brl(round2(priceNoTax1000))}`,
            `• **Cobrir taxa (1000 líquido):** gamepass ${gpCover1000} → você recebe 1000 → ${brl(round2(priceCover1000))}`,
            "",
            "Para calcular um valor específico, clique em **Comprar quantia específica**.",
          ].join("\n")
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: "❌ Deu erro aqui. Confira o console do bot.", ephemeral: true });
      } catch {}
    }
  }
});

// ===== START =====
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();