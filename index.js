require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionsBitField
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

function createPanelEmbed(config) {
  const embed = new EmbedBuilder()
    .setTitle(config.panel.title)
    .setDescription(config.panel.description)
    .setColor(0x7c3aed);

  if (config.panel.banner) embed.setImage(config.panel.banner);

  return embed;
}

client.once("ready", async () => {
  console.log("Bot online");

  const commands = [
    new SlashCommandBuilder()
      .setName("painel")
      .setDescription("Configurar painel")
      .addSubcommand(s =>
        s.setName("configurar")
         .setDescription("Abrir editor do painel"))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
});

client.on("interactionCreate", async interaction => {

  const config = loadConfig();

  // ===== COMANDO =====
  if (interaction.isChatInputCommand()) {

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "❌ Apenas administradores.", ephemeral: true });
    }

    const editor = new EmbedBuilder()
      .setTitle("⚙️ Editor de Painel")
      .setDescription("Configure seu painel abaixo.")
      .setColor(0x7c3aed);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("edit_title").setLabel("Editar Título").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("edit_desc").setLabel("Editar Descrição").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("edit_banner").setLabel("Editar Banner").setStyle(ButtonStyle.Primary),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("manage_products").setLabel("Produtos").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("edit_pix").setLabel("Editar PIX").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("save_panel").setLabel("Salvar Painel").setStyle(ButtonStyle.Success)
    );

    return interaction.reply({
      embeds: [editor],
      components: [row, row2],
      ephemeral: true
    });
  }

  // ===== BOTÕES =====
  if (interaction.isButton()) {

    // EDITAR TÍTULO
    if (interaction.customId === "edit_title") {
      const modal = new ModalBuilder()
        .setCustomId("modal_title")
        .setTitle("Editar Título");

      const input = new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Novo título")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // EDITAR DESCRIÇÃO
    if (interaction.customId === "edit_desc") {
      const modal = new ModalBuilder()
        .setCustomId("modal_desc")
        .setTitle("Editar Descrição");

      const input = new TextInputBuilder()
        .setCustomId("desc")
        .setLabel("Nova descrição")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // EDITAR BANNER
    if (interaction.customId === "edit_banner") {
      const modal = new ModalBuilder()
        .setCustomId("modal_banner")
        .setTitle("Editar Banner");

      const input = new TextInputBuilder()
        .setCustomId("banner")
        .setLabel("URL da imagem")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // GERENCIAR PRODUTOS
    if (interaction.customId === "manage_products") {
      const modal = new ModalBuilder()
        .setCustomId("modal_product")
        .setTitle("Adicionar Produto");

      const name = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Nome do Produto")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const price = new TextInputBuilder()
        .setCustomId("price")
        .setLabel("Preço")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(name),
        new ActionRowBuilder().addComponents(price)
      );

      return interaction.showModal(modal);
    }

    // SALVAR PAINEL
    if (interaction.customId === "save_panel") {

      if (!config.panel.channelId)
        config.panel.channelId = interaction.channel.id;

      const channel = await client.channels.fetch(config.panel.channelId);

      const embed = createPanelEmbed(config);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("select_product")
        .setPlaceholder("Escolha um produto")
        .addOptions(
          config.products.map(p => ({
            label: p.name,
            description: `R$ ${p.price}`,
            value: p.name
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      if (config.panel.messageId) {
        const msg = await channel.messages.fetch(config.panel.messageId);
        await msg.edit({ embeds: [embed], components: [row] });
      } else {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        config.panel.messageId = msg.id;
      }

      saveConfig(config);

      return interaction.reply({ content: "✅ Painel salvo/atualizado.", ephemeral: true });
    }
  }

  // ===== MODAIS =====
  if (interaction.isModalSubmit()) {

    if (interaction.customId === "modal_title") {
      config.panel.title = interaction.fields.getTextInputValue("title");
    }

    if (interaction.customId === "modal_desc") {
      config.panel.description = interaction.fields.getTextInputValue("desc");
    }

    if (interaction.customId === "modal_banner") {
      config.panel.banner = interaction.fields.getTextInputValue("banner");
    }

    if (interaction.customId === "modal_product") {
      const name = interaction.fields.getTextInputValue("name");
      const price = interaction.fields.getTextInputValue("price");

      config.products.push({ name, price });
    }

    saveConfig(config);

    return interaction.reply({ content: "Salvo com sucesso.", ephemeral: true });
  }

});
client.login(TOKEN);