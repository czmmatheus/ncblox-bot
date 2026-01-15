if (i.isChatInputCommand() && i.commandName === "gmp") {
  try {
    // Ajuste estes IDs para os seus (ou use ENV)
    const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
    const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1461273267225497754";
    const BUYER_ROLE_ID = process.env.BUYER_ROLE_ID || "1459480515408171217";
    const BRAND = "𝗡𝗖 𝗕𝗟𝗢𝗫";
    const PURPLE = 0x7c3aed;

    if (!hasStaff(i.member, STAFF_ROLE_ID)) {
      return i.reply({ content: "❌ Sem permissão.", ephemeral: true });
    }

    const ownerId = ownerFromTopic(i.channel?.topic || "");
    if (!ownerId) {
      return i.reply({ content: "❌ Use /gmp dentro de um ticket criado pelo bot.", ephemeral: true });
    }

    await i.deferReply({ ephemeral: true });

    const link = await findLastGamepassLink(i.channel);
    if (!link) {
      return i.editReply("❌ Não achei link de Gamepass no ticket. O cliente precisa mandar o link.");
    }

    const { name, robux } = await getGamepassNameAndRobux(link);

    // SEM TAXA (gamepass direta)
    const total = round2((robux / 1000) * RATE_PER_1000);

    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle(`📌 Gamepass — ${BRAND}`)
      .setDescription(
        [
          `**${name} — ${robux} Robux**`,
          `💰 **${brl(total)}**`,
          `🔗 ${link}`,
          `📅 ${ddmmyy()}`,
          `👤 Cliente: <@${ownerId}>`,
          `🧰 Staff: <@${i.user.id}>`,
          `📁 Ticket: ${i.channel}`,
        ].join("\n")
      );

    const logCh = await i.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (logCh && logCh.isTextBased()) {
      await logCh.send({ embeds: [embed] });
    } else {
      await i.channel.send({ content: "⚠️ Canal de logs inválido/sem permissão.", embeds: [embed] });
    }

    // Dar cargo comprador
    try {
      const member = await i.guild.members.fetch(ownerId);
      if (member && !member.roles.cache.has(BUYER_ROLE_ID)) {
        await member.roles.add(BUYER_ROLE_ID, "Compra Gamepass registrada via /gmp");
      }
    } catch {}

    await i.channel.send("✅ Gamepass registrada. Cargo aplicado. 🔒 Fechando ticket em 5s…");
    setTimeout(() => i.channel.delete("Finalizado via /gmp").catch(() => {}), 5000);

    return i.editReply("✅ Registrado nos logs e ticket fechado.");
  } catch (e) {
    console.error(e);
    return i.editReply(`❌ Falhou: ${e?.message || "erro desconhecido"}`);
  }
}