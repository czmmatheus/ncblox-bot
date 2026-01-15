const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

// CONFIG
const RATE_PER_1000 = 30; // R$ 30 por 1000 robux
const TAX_MULTIPLIER = 1.3; // "com taxa" = +30% => 39 por 1000
const PURPLE = 0x7c3aed;

function brl(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function calcPriceBRL(robux, coverTax) {
  const base = (robux / 1000) * RATE_PER_1000;
  return coverTax ? base * TAX_MULTIPLIER : base;
}

// (Opcional) cálculo do gamepass pra cobrir taxa real 30% do Roblox:
function gamepassPriceToNet(robuxDesired) {
  return Math.ceil(robuxDesired / 0.7);
}

// 1) ENVIAR O PAINEL (ex.: comando /painel)
async function sendPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("Central de pedidos - New Store")
    .setDescription(
      [
        "**Compre agora mesmo:**",
        "• **Robux:** entrega em 1 a 2 dias úteis (exemplo).",
        "• **Gamepass:** envio instantâneo (exemplo).",
        "",
        `📌 **Tabela:** 1000 Robux = ${brl(RATE_PER_1000)}`,
      ].join("\n")
    )
    .setImage("https://SUA-IMAGEM-AQUI.com/banner.png"); // troque

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("buy_specific")
      .setLabel("Comprar quantia específica")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("calc_values")
      .setLabel("Calcular valores")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// 2) INTERAÇÕES (botões)
async function handleInteraction(interaction) {
  // Botão: comprar
  if (interaction.isButton() && interaction.customId === "buy_specific") {
    // Primeiro: escolher com/sem taxa antes de ticket
    const select = new StringSelectMenuBuilder()
      .setCustomId("choose_tax_mode")
      .setPlaceholder("Selecione como você quer pagar")
      .addOptions([
        { label: "Cobrir taxa (+30%)", value: "cover_tax" },
        { label: "Sem taxa (valor normal)", value: "no_tax" },
      ]);

    const row = new ActionRowBuilder().addComponents(select);

    return interaction.reply({
      content: "Antes de abrir o ticket, escolha uma opção:",
      components: [row],
      ephemeral: true,
    });
  }

  // Select: modo de taxa
  if (interaction.isStringSelectMenu() && interaction.customId === "choose_tax_mode") {
    const mode = interaction.values[0]; // cover_tax | no_tax

    // Agora abre modal pedindo Nick + Robux
    const modal = new ModalBuilder()
      .setCustomId(`order_modal:${mode}`)
      .setTitle("Pedido de Robux");

    const nick = new TextInputBuilder()
      .setCustomId("nick")
      .setLabel("Nick do Roblox")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const amount = new TextInputBuilder()
      .setCustomId("robux")
      .setLabel("Quantidade de Robux")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nick),
      new ActionRowBuilder().addComponents(amount)
    );

    return interaction.showModal(modal);
  }

  // Modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("order_modal:")) {
    const mode = interaction.customId.split(":")[1];
    const coverTax = mode === "cover_tax";

    const nick = interaction.fields.getTextInputValue("nick").trim();
    const robux = Number(interaction.fields.getTextInputValue("robux").trim());

    if (!Number.isFinite(robux) || robux <= 0) {
      return interaction.reply({ content: "Quantidade inválida.", ephemeral: true });
    }

    const price = calcPriceBRL(robux, coverTax);

    // Se você quiser sugerir o preço do gamepass pra cobrir taxa real:
    const gp = gamepassPriceToNet(robux);

    return interaction.reply({
      content:
        `✅ **Pedido registrado**\n` +
        `• Nick: **${nick}**\n` +
        `• Robux: **${robux}**\n` +
        `• Opção: **${coverTax ? "Cobrir taxa (+30%)" : "Sem taxa"}**\n` +
        `• Total: **${brl(price)}**\n\n` +
        `📌 **Instrução (Gamepass):**\n` +
        `- Se quiser receber líquido com taxa real de 30%, a gamepass geralmente precisa estar em: **${gp} Robux** (≈ robux/0.7).\n`,
      ephemeral: true,
    });
  }

  // Botão: calcular valores
  if (interaction.isButton() && interaction.customId === "calc_values") {
    return interaction.reply({
      content:
        `📌 **Calculadora**\n` +
        `• 1000 Robux = ${brl(RATE_PER_1000)}\n` +
        `• Com taxa (+30%) = ${brl(RATE_PER_1000 * 1.3)} por 1000\n\n` +
        `Me diga uma quantidade (ex.: 2500) que eu calculo também.`,
      ephemeral: true,
    });
  }
}

module.exports = { sendPanel, handleInteraction };