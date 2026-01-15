const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.once("ready", () => {
  console.log("NcBlox pronto!");
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "comprar") {
    await interaction.reply({
      content: "📦 **Pedido iniciado!**\nEnvie o nome do usuário do Roblox e a quantidade de Robux.",
      ephemeral: true
    });
  }

  if (interaction.customId === "cancelar") {
    await interaction.reply({
      content: "❌ Pedido cancelado.",
      ephemeral: true
    });
  }
});

client.on(Events.GuildCreate, async guild => {
  const channel = guild.systemChannel;
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("comprar")
      .setLabel("📦 Comprar Robux")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancelar")
      .setLabel("❌ Cancelar")
      .setStyle(ButtonStyle.Danger)
  );

  channel.send({
    content: "**Bem-vindo ao NcBlox**\nClique em uma opção:",
    components: [row]
  });
});

client.login(process.env.TOKEN);
