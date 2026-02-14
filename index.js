require("dotenv").config();
const fs = require("fs");
const QRCode = require("qrcode");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  AttachmentBuilder
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

// ===== CARREGAR ARQUIVOS =====
function loadDB() {
  return JSON.parse(fs.readFileSync("./database.json"));
}

function loadConfig() {
  return JSON.parse(fs.readFileSync("./config.json"));
}

// ===== CRC16 =====
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// ===== GERAR PIX OFICIAL =====
function generatePix(key, name, city, amount) {

  const formattedAmount = amount.toFixed(2);

  const payload =
    "000201" +
    "26580014BR.GOV.BCB.PIX01" +
    key.length.toString().padStart(2, "0") +
    key +
    "52040000" +
    "5303986" +
    "54" + formattedAmount.length.toString().padStart(2, "0") + formattedAmount +
    "5802BR" +
    "59" + name.length.toString().padStart(2, "0") + name +
    "60" + city.length.toString().padStart(2, "0") + city +
    "62070503***" +
    "6304";

  const crc = crc16(payload);
  return payload + crc;
}

// ===== REGISTRAR COMANDO =====
client.once("ready", async () => {
  console.log("Bot online");

  const commands = [
    new SlashCommandBuilder()
      .setName("painel")
      .setDescription("Criar painel da loja")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
});

// ===== INTERAÇÕES =====
client.on("interactionCreate", async interaction => {

  const db = loadDB();
  const config = loadConfig();

  // CRIAR PAINEL
  if (interaction.isChatInputCommand()) {

    const embed = new EmbedBuilder()
      .setTitle("🛒 Loja Oficial")
      .setDescription("Selecione um produto abaixo.")
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

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });

    return interaction.reply({
      content: "Painel criado com sucesso.",
      ephemeral: true
    });
  }

  // SELECIONAR PRODUTO
  if (interaction.isStringSelectMenu()) {

    const product = db.products.find(p => p.id === interaction.values[0]);
    if (!product) return;

    const pixCode = generatePix(
      config.pixKey,
      config.receiverName,
      config.receiverCity,
      product.price
    );

    const qrBuffer = await QRCode.toBuffer(pixCode);
    const attachment = new AttachmentBuilder(qrBuffer, { name: "pix.png" });

    const embed = new EmbedBuilder()
      .setTitle("💳 Pagamento PIX")
      .addFields(
        { name: "Produto", value: product.name },
        { name: "Valor", value: `R$ ${product.price.toFixed(2)}` },
        { name: "PIX Copia e Cola", value: `\`\`\`${pixCode}\`\`\`` }
      )
      .setImage("attachment://pix.png")
      .setColor(0x22c55e);

    await interaction.reply({
      embeds: [embed],
      files: [attachment],
      ephemeral: true
    });
  }

});

client.login(TOKEN);