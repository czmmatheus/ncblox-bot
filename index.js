require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TICKET_CATEGORY_ID = "1472141492293206077";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

function loadDB() {
  return JSON.parse(fs.readFileSync("./database.json"));
}

function saveDB(data) {
  fs.writeFileSync("./database.json", JSON.stringify(data, null, 2));
}

function loadConfig() {
  return JSON.parse(fs.readFileSync("./config.json"));
}

client.once("ready", async () => {
  console.log("Bot online");

  const commands = [
    new SlashCommandBuilder()
      .setName("painel")
      .setDescription("Criar painel"),
    new SlashCommandBuilder()
      .setName("produto")
      .setDescription("Adicionar produto")
      .addStringOption(o => o.setName("id").setDescription("ID").setRequired(true))
      .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
      .addNumberOption(o => o.setName("preco").setDescription("Preço").setRequired(true))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
});

// ---------- INTERAÇÕES ----------
client.on("interactionCreate", async interaction => {

  const db = loadDB();
  const config = loadConfig();

  // ADICIONAR PRODUTO
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "produto") {

      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return interaction.reply({ content: "Apenas admin.", ephemeral: true });

      const id = interaction.options.getString("id");
      const nome = interaction.options.getString("nome");
      const preco = interaction.options.getNumber("preco");

      db.products.push({
        id,
        name: nome,
        price: preco,
        stock: []
      });

      saveDB(db);
      return interaction.reply({ content: "Produto criado.", ephemeral: true });
    }

    if (interaction.commandName === "painel") {

      const embed = new EmbedBuilder()
        .setTitle("🛒 Loja")
        .setDescription("Selecione um produto.")
        .setColor(0x7c3aed);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("select_product")
        .setPlaceholder("Escolha um produto")
        .addOptions(
          db.products.map(p => ({
            label: p.name,
            description: `R$ ${p.price}`,
            value: p.id
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      await interaction.channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: "Painel criado.", ephemeral: true });
    }
  }

  // SELECIONAR PRODUTO
  if (interaction.isStringSelectMenu()) {

    const product = db.products.find(p => p.id === interaction.values[0]);
    if (!product) return;

    const embed = new EmbedBuilder()
      .setTitle("💳 Pagamento PIX")
      .addFields(
        { name: "Produto", value: product.name },
        { name: "Valor", value: `R$ ${product.price.toFixed(2)}` },
        { name: "Chave PIX", value: config.pixKey }
      )
      .setColor(0x22c55e);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`buy_${product.id}`)
        .setLabel("Enviar Comprovante")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // CRIAR TICKET
  if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

    const productId = interaction.customId.replace("buy_", "");
    const product = db.products.find(p => p.id === productId);
    if (!product) return;

    const ticket = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: ["ViewChannel"]
        },
        {
          id: interaction.user.id,
          allow: ["ViewChannel", "SendMessages"]
        }
      ]
    });

    db.orders.push({
      userId: interaction.user.id,
      productId: product.id,
      ticketId: ticket.id,
      status: "AWAITING_PROOF"
    });

    saveDB(db);

    await ticket.send(
      `🧾 Olá <@${interaction.user.id}>\n\nEnvie o comprovante do pagamento aqui.\n\nValor: R$ ${product.price}`
    );

    return interaction.reply({ content: "Ticket criado.", ephemeral: true });
  }

  // DETECTAR COMPROVANTE (ANEXO)
  if (interaction.isMessageComponent()) return;

});


// DETECTAR MENSAGENS NO TICKET
client.on("messageCreate", async message => {

  if (message.author.bot) return;

  const db = loadDB();
  const config = loadConfig();

  const order = db.orders.find(o => o.ticketId === message.channel.id);
  if (!order) return;

  if (message.attachments.size > 0 && order.status === "AWAITING_PROOF") {

    order.status = "PROOF_SENT";
    saveDB(db);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_${message.channel.id}`)
        .setLabel("Confirmar Pagamento")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`deny_${message.channel.id}`)
        .setLabel("Negar")
        .setStyle(ButtonStyle.Danger)
    );

    message.channel.send({
      content: "🔔 Comprovante recebido. Staff confirme abaixo:",
      components: [row]
    });
  }
});

// CONFIRMAR PAGAMENTO
client.on("interactionCreate", async interaction => {

  if (!interaction.isButton()) return;

  const db = loadDB();

  if (interaction.customId.startsWith("confirm_")) {

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "Apenas staff.", ephemeral: true });

    const ticketId = interaction.customId.replace("confirm_", "");
    const order = db.orders.find(o => o.ticketId === ticketId);
    if (!order) return;

    const product = db.products.find(p => p.id === order.productId);

    if (product.stock.length === 0)
      return interaction.reply({ content: "Sem estoque.", ephemeral: true });

    const key = product.stock.shift();
    saveDB(db);

    const user = await client.users.fetch(order.userId);
    await user.send(`🔐 Sua key:\n\`\`\`${key}\`\`\``);

    await interaction.channel.send("✅ Pagamento confirmado. Produto enviado.");

    await interaction.channel.delete();
  }

});

client.login(TOKEN);