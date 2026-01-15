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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const PANEL_CHANNEL = process.env.PANEL_CHANNEL;

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("open_buy_modal").setLabel("📦 Comprar Robux").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cancel_panel").setLabel("❌ Cancelar").setStyle(ButtonStyle.Danger),
  );
}

function staffRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("confirm_order").setLabel("✅ Confirmar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("deny_order").setLabel("❌ Cancelar").setStyle(ButtonStyle.Danger),
  );
}

process.on("unhandledRejection", (e) => console.log("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.log("uncaughtException:", e));

client.once(Events.ClientReady, async () => {
  console.log("NcBlox pronto!");

  if (!PANEL_CHANNEL) {
    console.log("ERRO: PANEL_CHANNEL não definido.");
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
  // Botão: abre modal
  if (interaction.isButton() && interaction.customId === "open_buy_modal") {
    const modal = new ModalBuilder().setCustomId("buy_modal").setTitle("Pedido de Robux");

    const userInput = new TextInputBuilder()
      .setCustomId("roblox_user")
      .setLabel("Usuário do Roblox")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const amountInput = new TextInputBuilder()
      .setCustomId("robux_amount")
      .setLabel("Quantidade de Robux (somente números)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(userInput),
      new ActionRowBuilder().addComponents(amountInput)
    );

    return interaction.showModal(modal);
  }

  // Modal enviado: cria ticket
  if (interaction.isModalSubmit() && interaction.customId === "buy_modal") {
    const robloxUser = interaction.fields.getTextInputValue("roblox_user").trim();
    const raw = interaction.fields.getTextInputValue("robux_amount").trim();
    const robuxAmount = Number(raw.replace(/[^\d]/g, ""));

    if (!robuxAmount || robuxAmount <= 0) {
      return interaction.reply({ content: "❌ Quantidade inválida. Ex: 438", ephemeral: true });
    }

    const guild = interaction.guild;
    const orderId = Date.now().toString().slice(-6);

    // cria canal privado
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
    ];

    let ticket;
    try {
      ticket = await guild.channels.create({
        name: `pedido-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites
      });
    } catch (e) {
      console.log("ERRO criando canal:", e?.message || e);
      return interaction.reply({
        content: "❌ Não consegui criar o canal. Verifique se o bot tem **Gerenciar Canais** e se o cargo dele está acima.",
        ephemeral: true
      });
    }

    await ticket.send({
      content:
`🧾 **Novo Pedido (#${orderId})**
👤 Cliente: <@${interaction.user.id}>
🎮 Roblox: **${robloxUser}**
💰 Robux: **${robuxAmount}**

📎 Envie o comprovante aqui (se tiver).`,
      components: [staffRow()]
    });

    return interaction.reply({ content: `✅ Pedido criado: <#${ticket.id}>`, ephemeral: true });
  }

  // Botões dentro do ticket
  if (interaction.isButton() && interaction.customId === "confirm_order") {
    return interaction.reply("✅ **Confirmado!** (entrega autorizada)");
  }

  if (interaction.isButton() && interaction.customId === "deny_order") {
    return interaction.reply("❌ **Cancelado.**");
  }

  if (interaction.isButton() && interaction.customId === "cancel_panel") {
    return interaction.reply({ content: "Ok 👍", ephemeral: true });
  }
});

client.login(process.env.TOKEN);