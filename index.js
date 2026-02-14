require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
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
      .setDescription("Criar painel"),
    new SlashCommandBuilder()
      .setName("produto")
      .setDescription("Gerenciar produtos")
      .addSubcommand(s =>
        s.setName("add")
          .setDescription("Adicionar produto")
          .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
          .addNumberOption(o => o.setName("preco").setDescription("Preço").setRequired(true))
      )
      .addSubcommand(s =>
        s.setName("remover")
          .setDescription("Remover produto")
          .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
      )
      .addSubcommand(s =>
        s.setName("listar").setDescription("Listar produtos")
      )
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

client.on("interactionCreate", async interaction => {

  const config = loadConfig();

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "produto") {

      if (interaction.options.getSubcommand() === "add") {
        const nome = interaction.options.getString("nome");
        const preco = interaction.options.getNumber("preco");

        config.products.push({ nome, preco });
        saveConfig(config);

        return interaction.reply({ content: "Produto adicionado.", ephemeral: true });
      }

      if (interaction.options.getSubcommand() === "remover") {
        const nome = interaction.options.getString("nome");
        config.products = config.products.filter(p => p.nome !== nome);
        saveConfig(config);

        return interaction.reply({ content: "Produto removido.", ephemeral: true });
      }

      if (interaction.options.getSubcommand() === "listar") {
        if (config.products.length === 0)
          return interaction.reply({ content: "Nenhum produto.", ephemeral: true });

        const lista = config.products.map(p => `${p.nome} - R$${p.preco}`).join("\n");
        return interaction.reply({ content: lista, ephemeral: true });
      }
    }

    if (interaction.commandName === "painel") {

      if (config.products.length === 0)
        return interaction.reply({ content: "Adicione produtos primeiro.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("🛒 Loja")
        .setDescription("Selecione um produto abaixo.")
        .setColor(0x7c3aed);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("select_produto")
        .setPlaceholder("Escolha um produto")
        .addOptions(
          config.products.map(p => ({
            label: p.nome,
            description: `Preço: R$${p.preco}`,
            value: p.nome
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      await interaction.channel.send({ embeds: [embed], components: [row] });

      interaction.reply({ content: "Painel criado.", ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "select_produto") {

      const produto = config.products.find(p => p.nome === interaction.values[0]);

      await interaction.reply({
        content: `Você selecionou **${produto.nome}**\nValor: R$${produto.preco}`,
        ephemeral: true
      });
    }
  }
});

client.login(TOKEN);