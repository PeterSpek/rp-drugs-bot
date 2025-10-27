import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, EmbedBuilder, InteractionType,
  UserSelectMenuBuilder
} from 'discord.js';
import Database from 'better-sqlite3';

// 🔹 Staff-rol heet letterlijk een punt:
const STAFF_ROLE_NAME = '.';
// 🔹 Backupkanaal-ID (waar de backup wordt geplaatst)
const BACKUP_CHANNEL_ID = '1431277178561233048';

// === Database ===
const db = new Database('rpstats.db');
db.exec(`
CREATE TABLE IF NOT EXISTS stats (
  userId TEXT PRIMARY KEY,
  coke INTEGER NOT NULL DEFAULT 0,
  meth INTEGER NOT NULL DEFAULT 0,
  wiet INTEGER NOT NULL DEFAULT 0
);
`);
const upsert = db.prepare(`
INSERT INTO stats (userId, coke, meth, wiet)
VALUES (@userId, @coke, @meth, @wiet)
ON CONFLICT(userId) DO UPDATE SET
  coke=excluded.coke, meth=excluded.meth, wiet=excluded.wiet;
`);
const getOne = db.prepare(`SELECT * FROM stats WHERE userId = ?`);
const getAll = db.prepare(`SELECT * FROM stats`);
const topAll = db.prepare(`SELECT userId, (coke+meth+wiet) AS total, coke, meth, wiet
                           FROM stats ORDER BY total DESC LIMIT 10`);
const sumAll = db.prepare(`SELECT SUM(coke) as sc, SUM(meth) as sm, SUM(wiet) as sw FROM stats`);
const deleteAll = db.prepare(`DELETE FROM stats`);

function addAmount(userId, drug, amount) {
  const existing = getOne.get(userId) || { coke: 0, meth: 0, wiet: 0 };
  existing[drug] = (existing[drug] || 0) + amount;
  upsert.run({ userId, ...existing });
}
function setAmounts(userId, coke, meth, wiet) {
  upsert.run({ userId, coke, meth, wiet });
}

// === Client ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

// === Commands registreren ===
client.once('ready', async () => {
  const cmds = [
    new SlashCommandBuilder().setName('start').setDescription('Open RP panel met knoppen'),
    new SlashCommandBuilder()
      .setName('persoon')
      .setDescription('Bekijk statistieken van een speler')
      .addUserOption(opt => opt.setName('speler').setDescription('Kies de speler').setRequired(true))
  ].map(c => c.toJSON());

  await client.application.commands.set(cmds);
  console.log(`✅ Bot online als ${client.user.tag}`);
});

// === Interacties ===
client.on('interactionCreate', async (i) => {
  try {
    // Slash: /start
    if (i.isChatInputCommand() && i.commandName === 'start') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('drug_coke').setLabel('Coke').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('drug_meth').setLabel('Meth').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('drug_wiet').setLabel('Wiet').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('overview_btn').setLabel('Overzicht').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('staff_panel').setLabel('⚙️ Staff Paneel').setStyle(ButtonStyle.Danger)
      );
      return i.reply({ content: 'RP Panel — kies een optie:', components: [row] });
    }

    // Slash: /persoon
    if (i.isChatInputCommand() && i.commandName === 'persoon') {
      const user = i.options.getUser('speler');
      const data = getOne.get(user.id);
      if (!data) return i.reply({ content: `Geen data gevonden voor ${user}.`, ephemeral: true });

      const total = data.coke + data.meth + data.wiet;
      const embed = new EmbedBuilder()
        .setTitle(`📊 Statistieken van ${user.username}`)
        .addFields(
          { name: '💨 Coke', value: String(data.coke), inline: true },
          { name: '⚗️ Meth', value: String(data.meth), inline: true },
          { name: '🌿 Wiet', value: String(data.wiet), inline: true },
          { name: '💰 Totaal', value: String(total), inline: true }
        )
        .setColor(0x2ecc71);
      return i.reply({ embeds: [embed] });
    }

    // === Buttons ===
    if (i.isButton()) {
      // Overzicht
      if (i.customId === 'overview_btn') {
        const rows = topAll.all();
        const sums = sumAll.get();

        const lines = rows.map((r, idx) =>
          `${idx + 1}. <@${r.userId}> — **${r.total} totaal** | 💨 **Coke:** ${r.coke} ⚗️ **Meth:** ${r.meth} 🌿 **Wiet:** ${r.wiet}`
        ).join('\n') || '_Nog geen data_';

        const embed = new EmbedBuilder()
          .setTitle('🏆 Top 10 (Totaal per speler)')
          .setDescription(lines)
          .addFields(
            { name: '📦 Totaal Coke', value: String(sums.sc || 0), inline: true },
            { name: '⚗️ Totaal Meth', value: String(sums.sm || 0), inline: true },
            { name: '🌿 Totaal Wiet', value: String(sums.sw || 0), inline: true },
            { name: '💰 Alles samen', value: String((sums.sc || 0) + (sums.sm || 0) + (sums.sw || 0)), inline: true }
          )
          .setColor(0x5865F2);

        return i.reply({ embeds: [embed] });
      }

      // Staff paneel
      if (i.customId === 'staff_panel') {
        const names = i.member.roles.cache.map(r => r.name);
        if (!names.includes(STAFF_ROLE_NAME)) {
          return i.reply({ content: '❌ Alleen staff mag dit gebruiken.', ephemeral: true });
        }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('staff_set_select').setLabel('✏️ Set waarden').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('staff_reset_select').setLabel('♻️ Reset speler').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('staff_reset_all').setLabel('🧹 Reset ALL').setStyle(ButtonStyle.Secondary)
        );
        return i.reply({ content: '⚙️ Staff Paneel — kies actie:', components: [row], ephemeral: true });
      }

      // Reset All — bevestiging
      if (i.customId === 'staff_reset_all') {
        const names = i.member.roles.cache.map(r => r.name);
        if (!names.includes(STAFF_ROLE_NAME))
          return i.reply({ content: 'Geen rechten.', ephemeral: true });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirm_reset_all').setLabel('✅ Bevestig').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('cancel_reset_all').setLabel('❌ Annuleer').setStyle(ButtonStyle.Secondary)
        );

        return i.reply({
          content: '⚠️ Weet je zeker dat je **ALLE data wilt wissen**? Dit kan niet ongedaan worden gemaakt.',
          components: [confirmRow],
          ephemeral: true
        });
      }

      // Reset All bevestigen
      if (i.customId === 'confirm_reset_all') {
        const allData = getAll.all();
        const backupText = allData.length
          ? allData.map(r => `<@${r.userId}> — C:${r.coke} M:${r.meth} W:${r.wiet}`).join('\n')
          : 'Geen data beschikbaar.';

        const backupChannel = client.channels.cache.get(BACKUP_CHANNEL_ID);
        if (backupChannel) {
          await backupChannel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('📦 Backup vóór volledige reset')
                .setDescription(backupText)
                .setColor(0x3498db)
                .setTimestamp()
            ]
          });
        }

        deleteAll.run();
        return i.update({ content: '🧹 Alle spelers zijn gereset. Backup is opgeslagen in het backupkanaal.', components: [] });
      }

      // Reset All annuleren
      if (i.customId === 'cancel_reset_all') {
        return i.update({ content: '❌ Reset geannuleerd.', components: [] });
      }

      // Staff set/reset individuele leden
      const staffMap = {
        staff_set_select: 'set',
        staff_reset_select: 'reset'
      };

      if (staffMap[i.customId]) {
        const names = i.member.roles.cache.map(r => r.name);
        if (!names.includes(STAFF_ROLE_NAME))
          return i.reply({ content: 'Geen rechten.', ephemeral: true });

        const action = staffMap[i.customId];
        const select = new UserSelectMenuBuilder()
          .setCustomId(`staff_select_${action}`)
          .setPlaceholder('Kies een lid…')
          .setMinValues(1)
          .setMaxValues(1);
        const row = new ActionRowBuilder().addComponents(select);
        return i.reply({ content: `Kies een lid om te ${action === 'set' ? 'wijzigen' : 'resetten'}:`, components: [row], ephemeral: true });
      }

      // Coke/Meth/Wiet knoppen
      const drugMap = { drug_coke: 'coke', drug_meth: 'meth', drug_wiet: 'wiet' };
      if (drugMap[i.customId]) {
        const drug = drugMap[i.customId];
        const select = new UserSelectMenuBuilder()
          .setCustomId(`select_${drug}`)
          .setPlaceholder('Kies een lid…')
          .setMinValues(1)
          .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(select);
        return i.reply({ content: `Kies het lid voor **${drug.toUpperCase()}**:`, components: [row], ephemeral: true });
      }
    }

    // === User select menu ===
    if (i.isUserSelectMenu()) {
      const id = i.customId;

      if (id.startsWith('staff_select_set')) {
        const userId = i.values[0];
        const modal = new ModalBuilder().setCustomId(`modal_staff_set_${userId}`).setTitle('✏️ Set waarden');
        const cokeInput = new TextInputBuilder().setCustomId('coke').setLabel('Coke').setStyle(TextInputStyle.Short).setRequired(true);
        const methInput = new TextInputBuilder().setCustomId('meth').setLabel('Meth').setStyle(TextInputStyle.Short).setRequired(true);
        const wietInput = new TextInputBuilder().setCustomId('wiet').setLabel('Wiet').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(cokeInput),
          new ActionRowBuilder().addComponents(methInput),
          new ActionRowBuilder().addComponents(wietInput)
        );
        return i.showModal(modal);
      }

      if (id.startsWith('staff_select_reset')) {
        const userId = i.values[0];
        setAmounts(userId, 0, 0, 0);
        return i.reply({ content: `♻️ Data van <@${userId}> is gereset.`, ephemeral: false });
      }

      if (id.startsWith('select_')) {
        const drug = id.replace('select_', '');
        const userId = i.values[0];

        const modal = new ModalBuilder()
          .setCustomId(`modal_amount_${drug}_${userId}`)
          .setTitle(`Aantal voor ${drug.toUpperCase()}`);

        const amtInput = new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('Aantal (integer)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(amtInput));
        return i.showModal(modal);
      }
    }

    // === Modal submits ===
    if (i.type === InteractionType.ModalSubmit) {
      const id = i.customId;

      if (id.startsWith('modal_amount_')) {
        const parts = id.split('_');
        const drug = parts[2];
        const userId = parts.slice(3).join('_');
        const amt = parseInt(i.fields.getTextInputValue('amount').trim(), 10);
        if (isNaN(amt)) return i.reply({ content: 'Aantal moet een getal zijn.', ephemeral: true });

        addAmount(userId, drug, amt);
        const row = getOne.get(userId);
        const total = row.coke + row.meth + row.wiet;
        return i.reply({ content: `✅ Toegevoegd: **${amt} ${drug}** voor <@${userId}>. Totaal: ${total}`, ephemeral: false });
      }

      if (id.startsWith('modal_staff_set_')) {
        const userId = id.replace('modal_staff_set_', '');
        const c = parseInt(i.fields.getTextInputValue('coke').trim(), 10);
        const m = parseInt(i.fields.getTextInputValue('meth').trim(), 10);
        const w = parseInt(i.fields.getTextInputValue('wiet').trim(), 10);
        if ([c, m, w].some(isNaN)) return i.reply({ content: 'Ongeldige invoer.', ephemeral: true });
        setAmounts(userId, c, m, w);
        return i.reply({ content: `✏️ Waarden ingesteld voor <@${userId}> — C:${c} M:${m} W:${w}`, ephemeral: false });
      }
    }
  } catch (err) {
    console.error(err);
    if (i.isRepliable()) i.reply({ content: '⚠️ Er ging iets mis.', ephemeral: true }).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
