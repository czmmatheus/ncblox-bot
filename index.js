const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function painelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("comprar")
      .setLabel("📦 Comprar Robux")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancelar")
      .setLabel("❌ Cancelar")
      .setStyle(ButtonStyle.Danger)
  );
}

process.on("unhandledRejection", (err) => {
  console.log("unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.log("uncaughtException:", err);
});

client.once(Events.ClientReady, async () => {
  console.log("NcBlox pronto!");

  const channelId = process.env.PANEL_CHANNEL;
  if (!channelId) {
    console.log("ERRO: PANEL_CHANNEL não existe nas Variables.");
    return; // não derruba o bot
  }

  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch) {
      console.log("ERRO: canal não encontrado. Confira o ID.");
      return;
    }

    await ch.send({
      content: "**🛍️ Central de Pedidos — NcBlox**\nClique em uma opção:",
      components: [painelRow()]
    });

    console.log("Painel enviado com sucesso.");
  } catch (e) {
    console.log("ERRO ao enviar painel (sem derrubar o bot):", e?.message || e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "comprar") {
    return interaction.reply({
      content: "📦 **Pedido iniciado!**\nEnvie seu usuário do Roblox e a quantidade de Robux.",
      ephemeral: true
    });
  }

  if (interaction.customId === "cancelar") {
    return interaction.reply({
      content: "❌ Pedido cancelado.",
      ephemeral: true
    });
  }
});

client.login(process.env.TOKEN);
