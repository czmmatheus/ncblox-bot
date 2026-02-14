require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

// PIX FIXO (depois podemos deixar configurável)
const PIX_COPIA_COLA = "SEU_PIX_AQUI";

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

  // SELECIONAR PRODUTO
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "select_produto") {

      const produto = config.products.find(p => p.nome === interaction.values[0]);

      const carrinho = new EmbedBuilder()
        .setTitle("🛒 Bem-vindo ao seu Carrinho")
        .setDescription(`Você está comprando: **${produto.nome}**`)
        .addFields(
          { name: "Valor", value: `R$ ${produto.preco}`, inline: true },
          { name: "Quantidade", value: "1", inline: true }
        )
        .setColor(0x7c3aed);

      const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pagar_${produto.nome}`)
          .setLabel("Ir para Pagamento")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("cancelar")
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        embeds: [carrinho],
        components: [botoes],
        ephemeral: true
      });
    }
  }

  // PAGAMENTO
  if (interaction.isButton()) {

    if (interaction.customId.startsWith("pagar_")) {

      const produtoNome = interaction.customId.replace("pagar_", "");
      const produto = config.products.find(p => p.nome === produtoNome);

      const pagamento = new EmbedBuilder()
        .setTitle("💳 Confirmação de Compra")
        .setDescription(`Produto: **${produto.nome}**`)
        .addFields(
          { name: "Valor Total", value: `R$ ${produto.preco}` }
        )
        .setColor(0x22c55e);

      await interaction.update({
        embeds: [pagamento],
        components: []
      });

      await interaction.followUp({
        content: `🔐 PIX Copia e Cola:\n\`\`\`${PIX_COPIA_COLA}\`\`\``,
        ephemeral: true
      });
    }

    if (interaction.customId === "cancelar") {
      await interaction.update({
        content: "Compra cancelada.",
        embeds: [],
        components: []
      });
    }
  }
});

client.login(TOKEN);