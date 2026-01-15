const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID; // opcional
const PANEL_CHANNEL = process.env.PANEL_CHANNEL;

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_buy_modal")
      .setLabel("📦 Comprar Robux")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancel_panel")
      .setLabel("❌ Cancelar")
      .setStyle(ButtonStyle.Danger)
  );
}

function staffRow(orderId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_${orderId}`)
      .setLabel("✅ Confirmar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny_${orderId}`)
      .setLabel("❌ Cancelar")
      .setStyle(ButtonStyle.Danger)
  );
}

process.on("unhandledRejection", (err) => console.log("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.log("uncaughtException:", err));

client.once(Events.ClientReady, async () => {
  console.log(`NcBlox pronto! ${client.user.tag}`);

  if (!PANEL_CHANNEL) {
    console.log("ERRO: PANEL_CHANNEL não definido nas Variables.");
    return;
  }

  try {
    const ch = await client.channels.fetch(PANEL_CHANNEL);
    await ch.send({
      content: "🎁 **Central de Pedidos — NcBlox**\nClique em uma opção:",
      components: [panelRow()]
    });
    console.log("Painel enviado.");
  } catch (e) {
    console.log("ERRO ao enviar painel:", e?.message || e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // 1) Botão: abrir formulário
  if (interaction.isButton() && interaction.customId === "open_buy_modal") {
    const modal = new ModalBuilder()
      .setCustomId("buy_modal")
      .setTitle("Pedido de Robux");

    const userInput = new TextInputBuilder()
      .setCustomId("roblox_user")
      .setLabel("Usuário do Roblox")
      .setPlaceholder("ex: cheroso_game")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const amountInput = new TextInputBuilder()
      .setCustomId("robux_amount")
      .setLabel("Quantidade de Robux")
      .setPlaceholder("ex: 438")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents