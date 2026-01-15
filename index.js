const {
  Client, GatewayIntentBits,
  REST, Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder, TextInputStyle,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");

const axios = require("axios");
const cheerio = require("cheerio");

// ================== CONFIG / ENV ==================
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1461273267225497754";
const BUYER_ROLE_ID = process.env.BUYER_ROLE_ID || "1459480515408171217";

const RATE_PER_1000 = 28;
const PRICE_MULT = 1.30;
const PURPLE = 0x7c3aed;
const AUTO_CLOSE_MS = 24 * 60 * 60 * 1000;

const BANNER_URL = "https://cdn.discordapp.com/attachments/1428217284660564125/1461373724535029893/file_000000007a1471f6bb88daa791749f60.png";

// ================== HELPERS ==================
function brl(n){ return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
function round2(n){ return Math.round(n*100)/100; }
function priceBRL(robux, withTax){
  const base=(robux/1000)*RATE_PER_1000;
  return withTax?base*PRICE_MULT:base;
}
function priceGamepassBRL(robux){ return (robux/1000)*RATE_PER_1000; }
function formatDateDDMMYY(d=new Date()){
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getFullYear()).slice(-2)}`;
}
function hasStaffRole(m){ return m?.roles?.cache?.has(STAFF_ROLE_ID); }
function parseTicketOwnerIdFromTopic(t=""){ return t.match(/ticketOwner:(\d+)/)?.[1]||null; }

// ================== SCRAPER ==================
async function fetchGamepassInfo(url){
  const { data } = await axios.get(url,{headers:{"User-Agent":"Mozilla/5.0"}});
  const $=cheerio.load(data);

  const name=$('h1[itemprop="name"]').text().trim() ||
    $('meta[property="og:title"]').attr("content") || "Gamepass";

  let priceTxt=$('[data-testid="price-label"]').first().text() ||
    $('[class*="price"]').first().text() || "";

  const robux=Number(priceTxt.replace(/[^\d]/g,""));
  if(!robux||robux<=0) throw new Error("Não foi possível ler o preço.");

  return { name, robux };
}

// ================== COMMANDS ==================
async function registerCommands(){
  const commands=[
    new SlashCommandBuilder().setName("cmd").setDescription("Painel principal (vendas)"),
    new SlashCommandBuilder().setName("2cmd").setDescription("Painel da calculadora"),
    new SlashCommandBuilder().setName("logs").setDescription("Logs Robux"),
    new SlashCommandBuilder().setName("gamepass").setDescription("Staff: registra venda de Gamepass"),
  ].map(c=>c.toJSON());

  const rest=new REST({version:"10"}).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
}

// ================== BOT ==================
const client=new Client({intents:[GatewayIntentBits.Guilds]});
client.once("ready",()=>console.log("BOT ONLINE"));

// (continua na PARTE 2/2)
// ================== PANELS ==================
async function sendMainPanel(channel){
  const embed=new EmbedBuilder().setColor(PURPLE).setTitle("NCBlox Store")
    .setDescription(`• Sem taxa: 1000 = ${brl(RATE_PER_1000)}\n• Com taxa: 1000 = ${brl(RATE_PER_1000*PRICE_MULT)}`)
    .setImage(BANNER_URL);

  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("buy_robux").setLabel("Comprar Robux").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("send_gamepass").setLabel("Gamepass").setStyle(ButtonStyle.Secondary)
  );
  await channel.send({embeds:[embed],components:[row]});
}

async function sendCalcPanel(channel){
  const embed=new EmbedBuilder().setColor(PURPLE).setTitle("Calculadora")
    .setDescription("1000 = R$28").setImage(BANNER_URL);

  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("calc_no_tax").setLabel("Sem taxa").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("calc_with_tax").setLabel("Com taxa").setStyle(ButtonStyle.Primary)
  );
  await channel.send({embeds:[embed],components:[row]});
}

// ================== TICKETS ==================
const ticketTimers=new Map();
function cancelTicketTimer(id){ if(ticketTimers.has(id)){clearTimeout(ticketTimers.get(id));ticketTimers.delete(id);} }

async function createTicketChannel(guild,user){
  const name=`ticket-${user.username}-${user.id.slice(-4)}`;
  const ch=await guild.channels.create({
    name, type:ChannelType.GuildText, parent:TICKET_CATEGORY_ID||undefined,
    topic:`ticketOwner:${user.id}`,
    permissionOverwrites:[
      {id:guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},
      {id:user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]},
      {id:STAFF_ROLE_ID,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]},
    ],
  });
  const t=setTimeout(async()=>{ try{await ch.send("Auto close");await ch.delete();}catch{} },AUTO_CLOSE_MS);
  ticketTimers.set(ch.id,t);
  return ch;
}

// ================== INTERACTIONS ==================
client.on("interactionCreate",async i=>{
try{
  if(i.isChatInputCommand() && i.commandName==="cmd"){ await sendMainPanel(i.channel); return i.reply({content:"OK",ephemeral:true}); }
  if(i.isChatInputCommand() && i.commandName==="2cmd"){ await sendCalcPanel(i.channel); return i.reply({content:"OK",ephemeral:true}); }

  if(i.isButton() && i.customId==="send_gamepass"){
    const m=new ModalBuilder().setCustomId("gp_modal").setTitle("Gamepass");
    m.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("nick").setLabel("Nick").setStyle(TextInputStyle.Short)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("link").setLabel("Link da Gamepass").setStyle(TextInputStyle.Short)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("robux").setLabel("Robux").setStyle(TextInputStyle.Short))
    );
    return i.showModal(m);
  }

  if(i.isModalSubmit() && i.customId==="gp_modal"){
    const nick=i.fields.getTextInputValue("nick");
    const link=i.fields.getTextInputValue("link");
    const robux=Number(i.fields.getTextInputValue("robux").replace(/[^\d]/g,""));
    const total=round2(priceGamepassBRL(robux));
    const ticket=await createTicketChannel(i.guild,i.user);
    await ticket.send(`Nick: ${nick}\nLink: ${link}\nRobux: ${robux}\nTotal: ${brl(total)}\nStaff use /gamepass`);
    return i.reply({content:`Ticket criado ${ticket}`,ephemeral:true});
  }

  if(i.isChatInputCommand() && i.commandName==="gamepass"){
    if(!hasStaffRole(i.member)) return i.reply({content:"Sem permissão",ephemeral:true});
    const owner=parseTicketOwnerIdFromTopic(i.channel.topic);
    const msgs=await i.channel.messages.fetch({limit:10});
    const txt=msgs.first().content;
    const logCh=await i.guild.channels.fetch(LOG_CHANNEL_ID);
    await logCh.send(`Venda Gamepass\n${txt}\nData ${formatDateDDMMYY()}`);
    const m=await i.guild.members.fetch(owner);
    await m.roles.add(BUYER_ROLE_ID);
    await i.channel.delete();
  }

}catch(e){console.error(e);}
});

// ================== START ==================
(async()=>{
  await registerCommands();
  await client.login(TOKEN);
})();