require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

function loadConfig() {
  return JSON.parse(fs.readFileSync("./config.json"));
}

function saveConfig(data) {
  fs.writeFileSync("./config.json", JSON.stringify(data, null, 2));
}

client.once("ready", async () => {
  console.log("Bot online");

  const commands = [
    new SlashCommandBuilder()
      .setName("painel")
      .setDescription("Configurar painel")
      .addSubcommand(s => s.setName("configurar").setDescription("Configurar painel"))
      .addSubcommand(s => s.setName("editar").setDescription("Editar painel"))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const config = loadConfig();

  if (interaction.options.getSubcommand() === "configurar") {

    const modal = new ModalBuilder()
      .setCustomId("setup_panel")
      .setTitle("Configurar Painel");

    const title = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("Título do Painel")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const description = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Descrição")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const banner = new TextInputBuilder()
      .setCustomId("banner")
      .setLabel("URL da Imagem/Banner")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(description),
      new ActionRowBuilder().addComponents(banner)
    );

    await interaction.showModal(modal);
  }

  if (interaction.options.getSubcommand() === "editar") {
    if (!config.panel) {
      return interaction.reply({ content: "Nenhum painel criado ainda.", ephemeral: true });
    }

    const channel = await client.channels.fetch(config.panel.channelId);
    const message = await channel.messages.fetch(config.panel.messageId);

    const embed = new EmbedBuilder()
      .setTitle(config.panel.title)
      .setDescription(config.panel.description)
      .setImage(config.panel.banner || null)
      .setColor(0x7c3aed);

    await message.edit({ embeds: [embed] });

    interaction.reply({ content: "Painel atualizado.", ephemeral: true });
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId === "setup_panel") {

    const config = loadConfig();

    const title = interaction.fields.getTextInputValue("title");
    const description = interaction.fields.getTextInputValue("description");
    const banner = interaction.fields.getTextInputValue("banner");

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setImage(banner || null)
      .setColor(0x7c3aed);

    const msg = await interaction.channel.send({ embeds: [embed] });

    config.panel = {
      title,
      description,
      banner,
      channelId: interaction.channel.id,
      messageId: msg.id
    };

    saveConfig(config);

    interaction.reply({ content: "Painel criado com sucesso.", ephemeral: true });
  }
});

client.login(TOKEN);