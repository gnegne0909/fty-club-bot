const {
    Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits,
    ChannelType, REST, Routes, ActivityType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, Events
} = require('discord.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================
// ===           CONFIGURATION                             ===
// ============================================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_APP_ID = process.env.DISCORD_CLIENT_APP_ID || '1470568087966187541';
const GUILD_ID = process.env.GUILD_ID || '1471212577957613762';
const SUPER_ADMIN_DISCORD_ID = '969065205067825222'; // Xywez uniquement
const PANEL_URL = process.env.PANEL_URL || 'https://fty-club-pro-1.onrender.com';
const PANEL_API_KEY = process.env.PANEL_API_KEY || 'fty-secret-api-key-2026';
const PORT = process.env.PORT || 3001;

if (!DISCORD_BOT_TOKEN) {
    console.error('╔═══════════════════════════════════════╗');
    console.error('║ ❌ DISCORD_BOT_TOKEN NON DÉFINI       ║');
    console.error('╚═══════════════════════════════════════╝');
    process.exit(1);
}
console.log('✅ Config validée | Port:', PORT, '| Panel:', PANEL_URL);

// ============================================================
// ===           STOCKAGE FICHIERS                          ===
// ============================================================
const CONFIG_PATH = path.join(__dirname, 'server-config.json');
const TICKETS_PATH = path.join(__dirname, 'tickets.json');

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (e) {}
    return {
        configured: false,
        categories: {},
        channels: { general: null, general2: null, general3: null, annonces: null, matchAnnonce: null, sanctions: null, postes: null, logs: null, bienvenue: null, reglement: null, recrutement: null, guide: null, officialAnnonces: null, giveaway: null, updates: null, tickets: null },
        roles: { owner: null, admin: null, moderateur: null, support: null, capitaine: null, joueur: null, membre: null, muted: null },
        antiRaid: { enabled: false, joinThreshold: 10, joinWindow: 10, action: 'kick' },
        antiLink: { enabled: false, whitelist: [], action: 'delete' },
        antiDouble: { enabled: false }
    };
}
function writeConfig(cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (e) {}
}
function readTickets() {
    try {
        if (fs.existsSync(TICKETS_PATH)) return JSON.parse(fs.readFileSync(TICKETS_PATH, 'utf-8'));
    } catch (e) {}
    return {};
}
function writeTickets(data) {
    try { fs.writeFileSync(TICKETS_PATH, JSON.stringify(data, null, 2)); } catch (e) {}
}

// ============================================================
// ===           ANTI-RAID STATE                           ===
// ============================================================
const recentJoins = [];

// ============================================================
// ===           CLIENT DISCORD                            ===
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildModeration
    ],
    partials: ['CHANNEL', 'MESSAGE', 'REACTION']
});

// ============================================================
// ===           ÉTAT BOT                                  ===
// ============================================================
let botStatus = {
    status: 'online',
    activity: { name: 'FTY Club Pro | /site', type: 0 },
    isReady: false,
    guilds: 0,
    members: 0,
    uptime: Date.now(),
    logs: [],
    commands: [],
    maintenanceMode: false,
    panelConnected: false
};

// ============================================================
// ===           COMMANDES SLASH DÉFINITIONS               ===
// ============================================================
const SLASH_COMMANDS = [
    { name: 'site',   description: '🌐 Affiche le lien du site FTY Club Pro' },
    { name: 'status', description: '📊 Statistiques du bot (Xywez uniquement)' },
    {
        name: 'setup',
        description: '⚙️ Configure le serveur Discord (Xywez uniquement)',
        default_member_permissions: String(PermissionFlagsBits.Administrator)
    },
    { name: 'ticket', description: '🎫 Ouvrir un ticket support en DM' },
    { name: 'reglement', description: '📜 Afficher le règlement du serveur' },
    { name: 'say', description: '📢 Écrire un message via le bot (staff+)', options: [
        { type: 3, name: 'message', description: 'Message à envoyer', required: true },
        { type: 7, name: 'salon', description: 'Salon cible (défaut: actuel)', required: false }
    ]}
];

// ============================================================
// ===           LOGS                                      ===
// ============================================================
function addBotLog(message, level = 'info', extra = {}) {
    const entry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        level, // info | warn | error | success | discord
        message,
        ...extra
    };
    botStatus.logs.unshift(entry);
    if (botStatus.logs.length > 1000) botStatus.logs = botStatus.logs.slice(0, 1000);
    const icons = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅', discord: '🎮' };
    console.log(`[${new Date().toLocaleTimeString()}] ${icons[level] || '•'} ${message}`);
    sendToPanel('log', entry).catch(() => {});
}

// ============================================================
// ===           COMMUNICATION PANEL                       ===
// ============================================================
async function sendToPanel(action, data) {
    try {
        const res = await axios.post(`${PANEL_URL}/api/bot`, {
            apiKey: PANEL_API_KEY, action, data
        }, { timeout: 8000, validateStatus: s => s < 500, headers: { 'User-Agent': 'FTY-Bot/4.0' } });
        botStatus.panelConnected = true;
        return res.data;
    } catch (e) {
        botStatus.panelConnected = false;
        return null;
    }
}

// ============================================================
// ===           HELPERS DISCORD                           ===
// ============================================================
async function sendDiscordDM(discordId, embedData) {
    try {
        const user = await client.users.fetch(discordId);
        await user.send({ embeds: [new EmbedBuilder(embedData)] });
        addBotLog(`📨 DM → ${discordId}`, 'success');
        return true;
    } catch (e) {
        addBotLog(`❌ DM impossible → ${discordId}: ${e.message}`, 'error');
        return false;
    }
}

async function sendToChannel(channelId, embedData, content = null) {
    if (!channelId) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        const opts = { embeds: [new EmbedBuilder(embedData)] };
        if (content) opts.content = content;
        await channel.send(opts);
        return true;
    } catch (e) {
        addBotLog(`❌ Salon ${channelId}: ${e.message}`, 'error');
        return false;
    }
}

function updateBotStatus(status, activityName, activityType) {
    if (!client.user) return false;
    try {
        botStatus.status = status;
        botStatus.activity = { name: activityName, type: activityType };
        client.user.setPresence({ status, activities: [{ name: activityName, type: parseInt(activityType) }] });
        addBotLog(`🎮 Statut → ${status} | ${activityName}`, 'success');
        return true;
    } catch (e) { addBotLog(`❌ Statut: ${e.message}`, 'error'); return false; }
}

function stringSimilarity(a, b) {
    if (a === b) return 1;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    const dp = Array.from({ length: longer.length + 1 }, (_, i) =>
        Array.from({ length: shorter.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= longer.length; i++)
        for (let j = 1; j <= shorter.length; j++)
            dp[i][j] = longer[i-1] === shorter[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return (longer.length - dp[longer.length][shorter.length]) / longer.length;
}

// ============================================================
// ===           ENREGISTREMENT COMMANDES                  ===
// ============================================================
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_APP_ID, GUILD_ID), { body: SLASH_COMMANDS });
        botStatus.commands = SLASH_COMMANDS.map(c => c.name);
        addBotLog(`✅ ${SLASH_COMMANDS.length} commandes enregistrées: ${botStatus.commands.join(', ')}`, 'success');
    } catch (e) {
        addBotLog(`❌ Enregistrement commandes: ${e.message}`, 'error');
    }
}

// ============================================================
// ===           ÉVÉNEMENT READY                           ===
// ============================================================
client.once('ready', async () => {
    botStatus.isReady = true;
    botStatus.uptime = Date.now();
    botStatus.guilds = client.guilds.cache.size;
    botStatus.members = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    client.user.setPresence({ status: 'online', activities: [{ name: 'FTY Club Pro | /site', type: ActivityType.Playing }] });
    addBotLog(`🚀 Bot: ${client.user.tag} | ${botStatus.guilds} serveur(s) | ${botStatus.members} membres`, 'success');
    await registerCommands();

    // Heartbeat au panel toutes les 30s
    setInterval(async () => {
        botStatus.guilds = client.guilds.cache.size;
        botStatus.members = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
        await sendToPanel('heartbeat', { isReady: true, guilds: botStatus.guilds, members: botStatus.members, uptime: botStatus.uptime });
    }, 30000);

    addBotLog('✅ Initialisation complète', 'success');
});

// ============================================================
// ===           ÉVÉNEMENT MEMBRE REJOINT                  ===
// ============================================================
client.on('guildMemberAdd', async member => {
    if (member.guild.id !== GUILD_ID) return;
    const cfg = readConfig();
    addBotLog(`👤 Rejoint: ${member.user.tag} (${member.id})`, 'discord');

    // ANTI-RAID
    if (cfg.antiRaid?.enabled) {
        const now = Date.now();
        recentJoins.push({ id: member.id, tag: member.user.tag, ts: now });
        const window = (cfg.antiRaid.joinWindow || 10) * 1000;
        while (recentJoins.length && now - recentJoins[0].ts > window) recentJoins.shift();
        const threshold = cfg.antiRaid.joinThreshold || 10;
        if (recentJoins.length >= threshold) {
            addBotLog(`🚨 ANTI-RAID: ${recentJoins.length} joins en ${cfg.antiRaid.joinWindow}s`, 'warn');
            try {
                if (cfg.antiRaid.action === 'kick') await member.kick('Anti-Raid automatique');
                else if (cfg.antiRaid.action === 'ban') await member.ban({ reason: 'Anti-Raid automatique' });
            } catch (e) {}
            if (cfg.channels?.logs) await sendToChannel(cfg.channels.logs, {
                title: '🚨 Anti-Raid Déclenché',
                description: `${recentJoins.length} membres ont rejoint en ${cfg.antiRaid.joinWindow}s\n**Action:** ${cfg.antiRaid.action}`,
                color: 0xef4444, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Anti-Raid' }
            });
            return;
        }
    }

    // ANTI-DOUBLE COMPTE
    if (cfg.antiDouble?.enabled) {
        const newName = member.user.username.toLowerCase();
        for (const [id, m] of member.guild.members.cache) {
            if (id === member.id || m.user.bot) continue;
            if (stringSimilarity(newName, m.user.username.toLowerCase()) > 0.85) {
                addBotLog(`⚠️ Anti-double: ${member.user.tag} ~ ${m.user.tag}`, 'warn');
                if (cfg.channels?.logs) await sendToChannel(cfg.channels.logs, {
                    title: '⚠️ Possible Double Compte',
                    description: `**Nouveau:** ${member.user.tag} (${member.id})\n**Existant:** ${m.user.tag} (${id})`,
                    color: 0xf59e0b, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Anti-Double' }
                });
                break;
            }
        }
    }

    // MESSAGE BIENVENUE
    if (cfg.channels?.bienvenue) {
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('🎉 Bienvenue sur FTY Club Pro !')
            .setDescription(`Bienvenue <@${member.id}> sur le serveur officiel **FTY Club Pro** !\n\n📜 **Lis le règlement** avant de commencer !\n🎫 **Ouvre un ticket** si tu as besoin d'aide.\n🌐 **Visite le site** : https://fty-club-pro-1.onrender.com`)
            .setColor(0x9333ea)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 Membre', value: member.user.tag, inline: true },
                { name: '📅 Rejoint le', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
                { name: '🎮 Compte créé', value: `<t:${Math.floor(member.user.createdAt.getTime()/1000)}:R>`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `FTY Club Pro | Membre #${member.guild.memberCount}` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('📜 Règlement').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${GUILD_ID}/${cfg.channels.reglement||member.guild.id}`),
            new ButtonBuilder().setLabel('🌐 Site Web').setStyle(ButtonStyle.Link).setURL('https://fty-club-pro-1.onrender.com'),
            new ButtonBuilder().setLabel('🎯 Candidature').setStyle(ButtonStyle.Link).setURL('https://fty-club-pro-1.onrender.com/candidature')
        );
        try {
            const ch = await client.channels.fetch(cfg.channels.bienvenue);
            await ch.send({ embeds: [welcomeEmbed], components: [row] });
        } catch(e) {}
    }

    // DM de bienvenue au nouveau membre
    await sendDiscordDM(member.id, {
        title: '👋 Bienvenue sur FTY Club Pro !',
        description: `Salut **${member.user.username}** !\n\nTu viens de rejoindre le serveur **FTY Club Pro**. Voici quelques infos :\n\n📜 **Règlement** : Lis-le attentivement dans le serveur\n🎫 **Support** : Utilise \`/ticket\` pour contacter le staff\n🌐 **Site web** : https://fty-club-pro-1.onrender.com\n🎯 **Candidature** : https://fty-club-pro-1.onrender.com/candidature\n\nBonne aventure ! ⚽`,
        color: 0x9333ea,
        timestamp: new Date().toISOString(),
        footer: { text: 'FTY Club Pro | Bienvenue' }
    });
});

// ============================================================
// ===           ÉVÉNEMENT MESSAGE (ANTI-LINK)             ===
// ============================================================
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild || message.guild.id !== GUILD_ID) return;
    const cfg = readConfig();
    if (!cfg.antiLink?.enabled) return;
    const linkRegex = /(https?:\/\/|discord\.gg\/|discord\.com\/invite\/)[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
    if (!linkRegex.test(message.content)) return;
    const whitelist = cfg.antiLink.whitelist || [];
    const isWhitelisted = whitelist.some(w => message.content.includes(w));
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    if (isWhitelisted || isAdmin) return;
    try {
        await message.delete();
        addBotLog(`🔗 Anti-link: msg supprimé de ${message.author.tag}`, 'warn');
        const w = await message.channel.send({ content: `⚠️ ${message.author}, les liens ne sont pas autorisés ici.` });
        setTimeout(() => w.delete().catch(() => {}), 5000);
    } catch (e) {}
});

// ============================================================
// ===           GESTION INTERACTIONS (COMMANDES SLASH)    ===
// ============================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, user } = interaction;
    addBotLog(`⌨️ /${commandName} par ${user.tag}`, 'discord');

    // Defer immédiat pour éviter le timeout "application ne répond plus"
    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (e) { return; }

    try {
        // ── /site ──────────────────────────────────────────────
        if (commandName === 'site') {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('🌐 FTY Club Pro - Site Officiel')
                    .setDescription('Accède au site et au panel officiel de FTY Club Pro !')
                    .addFields(
                        { name: '🔗 Site Web', value: '[fty-club-pro-1.onrender.com](https://fty-club-pro-1.onrender.com)', inline: true },
                        { name: '🔐 Panel Admin', value: '[Panel Login](https://fty-club-pro-1.onrender.com/panel/login)', inline: true }
                    )
                    .setColor(0x9333ea).setTimestamp().setFooter({ text: 'FTY Club Pro' })]
            });
        }

        // ── /status ────────────────────────────────────────────
        else if (commandName === 'status') {
            if (user.id !== SUPER_ADMIN_DISCORD_ID) {
                return await interaction.editReply({ content: '❌ Réservé à **Xywez** uniquement.' });
            }
            const up = Date.now() - botStatus.uptime;
            const cfg = readConfig();
            const tickets = Object.values(readTickets());
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('📊 Statistiques Bot FTY V4.0')
                    .setColor(0x9333ea)
                    .addFields(
                        { name: '🤖 Bot', value: botStatus.isReady ? '🟢 En ligne' : '🔴 Hors ligne', inline: true },
                        { name: '🌐 Panel', value: botStatus.panelConnected ? '🟢 Connecté' : '🔴 Off', inline: true },
                        { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true },
                        { name: '🎮 Serveurs', value: `${botStatus.guilds}`, inline: true },
                        { name: '👥 Membres', value: `${botStatus.members}`, inline: true },
                        { name: '⏱️ Uptime', value: `${Math.floor(up/86400000)}j ${Math.floor((up%86400000)/3600000)}h ${Math.floor((up%3600000)/60000)}m`, inline: true },
                        { name: '⚙️ Configuré', value: cfg.configured ? '✅ Oui' : '❌ Non', inline: true },
                        { name: '🛡️ Anti-Raid', value: cfg.antiRaid?.enabled ? '✅ Actif' : '❌ Off', inline: true },
                        { name: '🔗 Anti-Link', value: cfg.antiLink?.enabled ? '✅ Actif' : '❌ Off', inline: true },
                        { name: '🎫 Tickets', value: `${tickets.filter(t => t.status === 'open').length} ouverts / ${tickets.length} total`, inline: true },
                        { name: '📝 Logs', value: `${botStatus.logs.length}/1000`, inline: true },
                        { name: '⌨️ Commandes', value: botStatus.commands.join(', ') || 'Aucune', inline: false }
                    )
                    .setTimestamp().setFooter({ text: `FTY Club Pro V4.0 | ${user.tag}` })]
            });
        }

        // ── /setup ─────────────────────────────────────────────
        else if (commandName === 'setup') {
            if (user.id !== SUPER_ADMIN_DISCORD_ID) {
                return await interaction.editReply({ content: '❌ Réservé à **Xywez** uniquement.' });
            }
            const guild = interaction.guild;
            if (!guild) return await interaction.editReply({ content: '❌ Utilisez cette commande dans le serveur.' });

            await interaction.editReply({ content: '⏳ Configuration du serveur en cours... (30-60s)' });
            addBotLog('⚙️ Début /setup par Xywez', 'info');
            const cfg = readConfig();

            // 1. RÔLES
            const rolesDefs = [
                { key: 'owner',      name: '👑 Owner',          color: 0x9333ea, hoist: true },
                { key: 'admin',      name: '🛡️ Administrateur', color: 0x7c3aed, hoist: true },
                { key: 'moderateur', name: '⚖️ Modérateur',     color: 0xd946ef, hoist: true },
                { key: 'support',    name: '🎧 Support',          color: 0xec4899, hoist: true },
                { key: 'capitaine',  name: '🎯 Capitaine',        color: 0xf472b6, hoist: true },
                { key: 'joueur',     name: '⚽ Joueur',           color: 0xfbbf24, hoist: false },
                { key: 'membre',     name: '👤 Membre',           color: 0x6b7280, hoist: false },
                { key: 'muted',      name: '🔇 Muted',            color: 0x374151, hoist: false }
            ];
            for (const r of rolesDefs) {
                let role = guild.roles.cache.find(ro => ro.name === r.name);
                if (!role) role = await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, reason: '/setup FTY' });
                cfg.roles[r.key] = role.id;
                addBotLog(`  ✅ Rôle: ${r.name}`, 'success');
            }

            // 2. CATÉGORIES + SALONS
            const cats = [
                { key: 'info', name: '📋 INFORMATIONS', channels: [
                    { key: 'annonces', name: '📢・annonces' },
                    { key: 'officialAnnonces', name: '🏛️・annonces-officielles' },
                    { key: 'guide', name: '📖・guide' },
                    { key: 'reglement', name: '📜・règlement' },
                    { key: 'giveaway', name: '🎁・giveaway' },
                    { key: 'recrutement', name: '🎯・recrutement' }
                ]},
                { key: 'general_cat', name: '💬 GÉNÉRAL', channels: [
                    { key: 'general', name: '💬・général' },
                    { key: 'general2', name: '🗣️・discussion' },
                    { key: 'general3', name: '🎮・off-topic' },
                    { key: 'bienvenue', name: '👋・bienvenue' }
                ]},
                { key: 'compe_cat', name: '⚽ COMPÉTITION', channels: [
                    { key: 'matchAnnonce', name: '⚽・annonces-matchs' },
                    { key: 'postes', name: '🎯・postes-rôles' },
                    { key: 'updates', name: '🔄・mises-à-jour' }
                ]},
                { key: 'support_cat', name: '🎫 SUPPORT', channels: [
                    { key: 'tickets', name: '🎫・tickets' }
                ]},
                { key: 'staff_cat', name: '⚙️ STAFF', channels: [
                    { key: 'sanctions', name: '⚠️・sanctions' }, { key: 'logs', name: '📊・logs-bot' }
                ]}
            ];
            for (const cat of cats) {
                let catCh = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === cat.name);
                if (!catCh) catCh = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, reason: '/setup FTY' });
                cfg.categories[cat.key] = catCh.id;
                if (cat.key === 'staff_cat' && cfg.roles.moderateur) {
                    await catCh.permissionOverwrites.set([
                        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: cfg.roles.moderateur, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ]).catch(() => {});
                }
                for (const ch of cat.channels) {
                    let chan = guild.channels.cache.find(c => c.name === ch.name && c.type === ChannelType.GuildText);
                    if (!chan) chan = await guild.channels.create({ name: ch.name, type: ChannelType.GuildText, parent: catCh.id, reason: '/setup FTY' });
                    cfg.channels[ch.key] = chan.id;
                    addBotLog(`  ✅ Salon: ${ch.name}`, 'success');
                }
            }

            // 3. SYSTÈMES
            cfg.antiRaid = { enabled: true, joinThreshold: 8, joinWindow: 15, action: 'kick' };
            cfg.antiLink = { enabled: true, whitelist: ['fty-club-pro-1.onrender.com', 'discord.gg/fty'], action: 'delete' };
            cfg.antiDouble = { enabled: true };
            cfg.configured = true;
            writeConfig(cfg);
            await sendToPanel('configUpdate', cfg);

            // 4. EMBED RÈGLEMENT avec bouton à cocher
            if (cfg.channels.reglement) {
                const reglementEmbed = new EmbedBuilder()
                    .setTitle('📜 RÈGLEMENT — FTY Club Pro')
                    .setDescription('Bienvenue sur **FTY Club Pro** ! Veuillez lire et accepter le règlement ci-dessous pour accéder au serveur.\n\n**En cliquant sur ✅ Accepter, vous confirmez avoir lu et accepté toutes les règles.**')
                    .addFields(
                        { name: '1️⃣ Respect', value: 'Soyez respectueux envers tous les membres. Le harcèlement, les insultes et la discrimination sont interdits.', inline: false },
                        { name: '2️⃣ Spam', value: 'Aucun spam, flood ou messages répétitifs. Utilisez les salons appropriés.', inline: false },
                        { name: '3️⃣ Publicité', value: 'Toute publicité non autorisée est interdite.', inline: false },
                        { name: '4️⃣ Contenu', value: 'Aucun contenu NSFW, illégal ou choquant.', inline: false },
                        { name: '5️⃣ Staff', value: 'Respectez les décisions du staff. En cas de litige, ouvrez un ticket.', inline: false },
                        { name: '6️⃣ Discord ToS', value: 'Respectez les conditions d\'utilisation de Discord.', inline: false },
                        { name: '⚠️ Sanctions', value: 'Avertissement → Mute → Kick → Ban selon la gravité.', inline: false }
                    )
                    .setColor(0x9333ea)
                    .setTimestamp()
                    .setFooter({ text: 'FTY Club Pro | Règlement Officiel — Cliquez ✅ pour accepter' });
                const reglRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('accept_reglement').setLabel('✅ J\'accepte le règlement').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setLabel('🌐 Site Web').setStyle(ButtonStyle.Link).setURL('https://fty-club-pro-1.onrender.com')
                );
                try {
                    const reglChan = await client.channels.fetch(cfg.channels.reglement);
                    await reglChan.send({ embeds: [reglementEmbed], components: [reglRow] });
                } catch(e) {}
            }

            // 5. EMBED TICKET dans le salon tickets
            if (cfg.channels.tickets) {
                const ticketEmbed = new EmbedBuilder()
                    .setTitle('🎫 Support — FTY Club Pro')
                    .setDescription('Besoin d\'aide ? Tu as une question ou un problème ?\n\n**Comment créer un ticket :**\n\n> 1️⃣ Clique sur le bouton **Créer un ticket** ci-dessous\n> 2️⃣ Utilise la commande `/ticket` dans n\'importe quel salon\n> 3️⃣ Un membre du staff te répondra directement en **DM Discord**\n\n📌 **Règles des tickets :**\n- Un seul ticket ouvert à la fois\n- Sois précis dans ta demande\n- Respecte le staff\n\n⏱️ Temps de réponse moyen : **quelques minutes à quelques heures**')
                    .setColor(0x9333ea)
                    .setTimestamp()
                    .setFooter({ text: 'FTY Club Pro | Support' });
                const tickRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Créer un ticket').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setLabel('📖 Guide').setStyle(ButtonStyle.Link).setURL('https://fty-club-pro-1.onrender.com/guide')
                );
                try {
                    const tickChan = await client.channels.fetch(cfg.channels.tickets);
                    await tickChan.send({ embeds: [ticketEmbed], components: [tickRow] });
                } catch(e) {}
            }

            // 4. Log dans salon
            if (cfg.channels.logs) await sendToChannel(cfg.channels.logs, {
                title: '✅ Serveur Configuré !',
                description: `Configuré par **Xywez** le <t:${Math.floor(Date.now()/1000)}:F>\n**Rôles:** ${rolesDefs.length} | **Salons:** ${cats.reduce((a,c)=>a+c.channels.length,0)}\n**Systèmes actifs:** Anti-Raid, Anti-Link, Anti-Double`,
                color: 0x22c55e, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | /setup' }
            });

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Serveur Configuré avec Succès !')
                    .setColor(0x22c55e)
                    .setDescription('Tous les salons, catégories et rôles ont été créés.\n\n**Gérez tout depuis le panel owner** :\nhttps://fty-club-pro-1.onrender.com/panel/bot')
                    .addFields(
                        { name: '🎭 Rôles créés', value: `${rolesDefs.length}`, inline: true },
                        { name: '📁 Catégories', value: `${cats.length}`, inline: true },
                        { name: '💬 Salons', value: `${cats.reduce((a,c)=>a+c.channels.length,0)}`, inline: true },
                        { name: '🛡️ Anti-Raid', value: '✅ Actif (8j/15s → kick)', inline: true },
                        { name: '🔗 Anti-Link', value: '✅ Actif', inline: true },
                        { name: '👥 Anti-Double', value: '✅ Actif', inline: true }
                    )
                    .setTimestamp().setFooter({ text: 'FTY Club Pro V4.0' })]
            });
            addBotLog('✅ /setup terminé', 'success');
        }

        // ── /ticket ────────────────────────────────────────────
        else if (commandName === 'ticket') {
            const tickets = readTickets();
            const userId = user.id;
            const existing = Object.values(tickets).find(t => t.userId === userId && t.status === 'open');
            if (existing) {
                return await interaction.editReply({
                    content: `❌ Tu as déjà un ticket ouvert (\`${existing.id}\`).\nRéponds à ton DM pour continuer avec le staff.`
                });
            }

            const ticketId = `t_${Date.now()}`;
            const newTicket = { id: ticketId, userId, userTag: user.tag, discordId: userId, status: 'open', createdAt: new Date().toISOString(), messages: [], sujet: 'Ticket Support', claimedBy: null };
            tickets[ticketId] = newTicket;
            writeTickets(tickets);

            const dmOk = await sendDiscordDM(userId, {
                title: '🎫 Ticket Ouvert - FTY Club Pro',
                description: `Ton ticket a bien été ouvert !\n\n**ID:** \`${ticketId}\`\n\nUn membre du staff va te répondre ici directement en DM dès que possible.\n\n💬 Tu peux ajouter des informations supplémentaires en répondant à ce message.`,
                color: 0x9333ea, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Support' }
            });

            if (!dmOk) {
                delete tickets[ticketId];
                writeTickets(tickets);
                return await interaction.editReply({
                    content: '❌ Impossible d\'ouvrir ton ticket : **tes DMs sont fermés**.\n\nVa dans **Paramètres → Confidentialité** et active les messages privés.'
                });
            }

            await sendToPanel('newTicket', newTicket);
            const cfg = readConfig();
            if (cfg.channels?.logs) await sendToChannel(cfg.channels.logs, {
                title: '🎫 Nouveau Ticket',
                description: `**Membre:** ${user.tag} (${userId})\n**ID:** \`${ticketId}\`\n**Ouvert:** <t:${Math.floor(Date.now()/1000)}:F>`,
                color: 0x9333ea, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Tickets' }
            });
            addBotLog(`🎫 Ticket ouvert: ${ticketId} par ${user.tag}`, 'discord');

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Ticket Créé !')
                    .setColor(0x22c55e)
                    .setDescription(`Ton ticket \`${ticketId}\` est ouvert.\n\n📨 Vérifie tes **messages privés** — le staff va te répondre en DM.\n\n⏱️ Temps de réponse : quelques minutes à quelques heures.`)
                    .setTimestamp().setFooter({ text: 'FTY Club Pro | Support' })]
            });
        }

        // ── /reglement ─────────────────────────────────────────
        else if (commandName === 'reglement') {
            const cfg = readConfig();
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('📜 Règlement FTY Club Pro')
                    .setDescription('Voici les règles principales du serveur FTY Club Pro :\n\n1️⃣ **Respect** — Soyez respectueux envers tous les membres.\n2️⃣ **Spam** — Aucun spam ou flood.\n3️⃣ **Publicité** — Toute publicité non autorisée est interdite.\n4️⃣ **Contenu** — Aucun contenu NSFW ou illégal.\n5️⃣ **Staff** — Respectez les décisions du staff.\n6️⃣ **Discord ToS** — Respectez les CGU Discord.\n\n⚠️ **Sanctions** : Avertissement → Mute → Kick → Ban')
                    .setColor(0x9333ea)
                    .setTimestamp()
                    .setFooter({ text: 'FTY Club Pro | Règlement' })]
            });
        }

        // ── /say ───────────────────────────────────────────────
        else if (commandName === 'say') {
            const cfg = readConfig();
            const allowedRoles = [cfg.roles?.owner, cfg.roles?.admin, cfg.roles?.moderateur, cfg.roles?.support].filter(Boolean);
            const member = interaction.member;
            const hasPermission = user.id === SUPER_ADMIN_DISCORD_ID || member?.permissions.has(PermissionFlagsBits.ManageMessages) || allowedRoles.some(r => member?.roles?.cache?.has(r));
            if (!hasPermission) {
                return await interaction.editReply({ content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.' });
            }
            const message = interaction.options.getString('message');
            const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
            try {
                await targetChannel.send({ content: message });
                await interaction.editReply({ content: `✅ Message envoyé dans <#${targetChannel.id}>` });
                addBotLog(`📢 /say par ${user.tag} → #${targetChannel.name}: ${message.substring(0,50)}`, 'discord');
            } catch(e) {
                await interaction.editReply({ content: `❌ Impossible d'envoyer dans ce salon: ${e.message}` });
            }
        }

    } catch (err) {
        console.error(`❌ Erreur /${commandName}:`, err);
        addBotLog(`❌ Erreur /${commandName}: ${err.message}`, 'error');
        try { await interaction.editReply({ content: '❌ Une erreur est survenue. Réessaie.' }); } catch (e) {}
    }
});

// ============================================================
// ===           BOUTONS DISCORD (règlement, ticket)        ===
// ============================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const { customId, user } = interaction;
    const cfg = readConfig();

    // ✅ Bouton accepter règlement
    if (customId === 'accept_reglement') {
        try {
            if (cfg.roles?.membre) {
                const guild = client.guilds.cache.get(GUILD_ID);
                const guildMember = await guild?.members.fetch(user.id).catch(()=>null);
                if (guildMember && !guildMember.roles.cache.has(cfg.roles.membre)) {
                    await guildMember.roles.add(cfg.roles.membre).catch(()=>{});
                }
            }
            await interaction.reply({ content: '✅ **Règlement accepté !** Tu as maintenant accès au serveur. Bienvenue sur **FTY Club Pro** ! 🎉', ephemeral: true });
            addBotLog(`📜 Règlement accepté par ${user.tag}`, 'discord');
        } catch(e) {
            try { await interaction.reply({ content: '❌ Erreur lors de l\'acceptation.', ephemeral: true }); } catch(_) {}
        }
    }

    // 🎫 Bouton créer ticket depuis le salon
    else if (customId === 'create_ticket') {
        const tickets = readTickets();
        const existing = Object.values(tickets).find(t => t.userId === user.id && t.status === 'open');
        if (existing) return await interaction.reply({ content: `❌ Tu as déjà un ticket ouvert (\`${existing.id}\`). Vérifie tes DMs.`, ephemeral: true });
        const ticketId = `t_${Date.now()}`;
        const newTicket = { id: ticketId, userId: user.id, userTag: user.tag, discordId: user.id, status: 'open', createdAt: new Date().toISOString(), messages: [], sujet: 'Ticket Support', claimedBy: null };
        tickets[ticketId] = newTicket;
        writeTickets(tickets);
        const dmOk = await sendDiscordDM(user.id, { title: '🎫 Ticket Ouvert - FTY Club Pro', description: `Ton ticket a bien été ouvert !\n\n**ID:** \`${ticketId}\`\n\nUn membre du staff va te répondre ici directement en DM.`, color: 0x9333ea, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Support' } });
        if (!dmOk) { delete tickets[ticketId]; writeTickets(tickets); return await interaction.reply({ content: '❌ Tes DMs sont fermés. Active-les dans Paramètres → Confidentialité.', ephemeral: true }); }
        await sendToPanel('newTicket', newTicket);
        if (cfg.channels?.logs) await sendToChannel(cfg.channels.logs, { title: '🎫 Nouveau Ticket', description: `**Membre:** ${user.tag} (${user.id})\n**ID:** \`${ticketId}\``, color: 0x9333ea, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Tickets' } });
        addBotLog(`🎫 Ticket ouvert via bouton: ${ticketId} par ${user.tag}`, 'discord');
        await interaction.reply({ content: `✅ Ticket \`${ticketId}\` ouvert ! Vérifie tes **messages privés** 📨`, ephemeral: true });
    }
});


const app = express();
app.use(express.json({ limit: '5mb' }));

function verifyApiKey(req, res, next) {
    const key = req.body?.apiKey || req.headers['x-api-key'];
    if (key !== PANEL_API_KEY) { return res.status(401).json({ error: 'Invalid API key' }); }
    next();
}

// GET /api/status
app.get('/api/status', verifyApiKey, (req, res) => {
    const cfg = readConfig();
    const tickets = Object.values(readTickets());
    res.json({ ...botStatus, serverConfig: cfg, ticketsOpen: tickets.filter(t => t.status === 'open').length, ticketsTotal: tickets.length });
});

// GET /api/logs — logs détaillés pour le panel owner
app.get('/api/logs', verifyApiKey, (req, res) => {
    const { level, limit = 200, offset = 0 } = req.query;
    let logs = botStatus.logs;
    if (level) logs = logs.filter(l => l.level === level);
    res.json({ logs: logs.slice(parseInt(offset), parseInt(offset) + parseInt(limit)), total: logs.length });
});

// POST /api/update-status
app.post('/api/update-status', verifyApiKey, (req, res) => {
    const { status, activity, activityType } = req.body;
    if (!botStatus.isReady) return res.status(503).json({ error: 'Bot not ready' });
    const ok = updateBotStatus(status, activity, parseInt(activityType) || 0);
    res.json(ok ? { success: true, botStatus } : { success: false, error: 'Failed' });
});

// POST /api/send-dm — DM générique depuis le panel
app.post('/api/send-dm', verifyApiKey, async (req, res) => {
    const { discordId, embed, title, message, color } = req.body;
    if (!discordId) return res.status(400).json({ error: 'discordId requis' });
    const embedData = embed || {
        title: title || '📨 Message Staff - FTY Club Pro',
        description: message || '',
        color: typeof color === 'string' ? parseInt(color.replace('#',''),16) : (color || 0x9333ea),
        timestamp: new Date().toISOString(),
        footer: { text: 'FTY Club Pro' }
    };
    res.json({ success: await sendDiscordDM(discordId, embedData) });
});

// POST /api/announce — Annonces dans les salons Discord
app.post('/api/announce', verifyApiKey, async (req, res) => {
    const { type, message, titre, author, mentionEveryone } = req.body;
    const cfg = readConfig();
    const chMap = { global: cfg.channels?.annonces, match: cfg.channels?.matchAnnonce, conference: cfg.channels?.general, recrutement: cfg.channels?.recrutement, sanction: cfg.channels?.sanctions, poste: cfg.channels?.postes };
    const colMap = { global: 0x3b82f6, match: 0x22c55e, conference: 0xa855f7, recrutement: 0xf59e0b, sanction: 0xef4444, poste: 0xf472b6 };
    const emoMap = { global: '📢', match: '⚽', conference: '🎤', recrutement: '🎯', sanction: '⚠️', poste: '🎯' };
    const channelId = chMap[type] || cfg.channels?.annonces;
    if (!channelId) return res.json({ success: false, error: 'Salon non configuré. Lance /setup d\'abord.' });
    const ok = await sendToChannel(channelId, {
        title: `${emoMap[type]||'📢'} ${titre||'Annonce FTY Club Pro'}`,
        description: message, color: colMap[type]||0x9333ea,
        timestamp: new Date().toISOString(), footer: { text: `FTY Club Pro | ${author||'Staff'}` }
    }, mentionEveryone ? '@everyone' : null);
    addBotLog(`📢 Annonce ${type} par ${author}`, 'success');
    res.json({ success: ok });
});

// POST /api/announce-match — Annonce match détaillée avec convocation
app.post('/api/announce-match', verifyApiKey, async (req, res) => {
    const { adversaire, date, heure, competition, formation, capitaine, convocation, mentionEveryone, author } = req.body;
    const cfg = readConfig();
    if (!cfg.channels?.matchAnnonce) return res.json({ success: false, error: 'Salon match non configuré. Lance /setup.' });
    const fields = [];
    if (adversaire) fields.push({ name: '🆚 Adversaire', value: adversaire, inline: true });
    if (date) fields.push({ name: '📅 Date', value: date, inline: true });
    if (heure) fields.push({ name: '🕐 Heure', value: heure, inline: true });
    if (competition) fields.push({ name: '🏆 Compétition', value: competition, inline: true });
    if (capitaine) fields.push({ name: '🎯 Capitaine', value: capitaine, inline: true });
    if (formation) fields.push({ name: '📋 Formation', value: formation, inline: true });
    const ok = await sendToChannel(cfg.channels.matchAnnonce, {
        title: `⚽ MATCH — FTY Club Pro vs ${adversaire||'Adversaire'}`,
        description: convocation ? `📣 **Convocation officielle**\n\n${convocation}` : 'Un match est prévu ! Soyez prêts.',
        color: 0x22c55e, fields, timestamp: new Date().toISOString(),
        footer: { text: `FTY Club Pro | ${author||capitaine||'Staff'}` }
    }, mentionEveryone ? '@everyone' : null);
    addBotLog(`⚽ Annonce match vs ${adversaire} par ${author||capitaine}`, 'success');
    res.json({ success: ok });
});

// POST /api/ticket — Gestion tickets depuis le panel (reply/claim/close)
app.post('/api/ticket', verifyApiKey, async (req, res) => {
    const { discordId, sujet, staffMessage, staffName, ticketId, action } = req.body;
    if (!discordId) return res.status(400).json({ error: 'discordId requis' });
    const tickets = readTickets();

    if (action === 'claim' && ticketId) {
        if (tickets[ticketId]) { tickets[ticketId].claimedBy = staffName||'Staff'; tickets[ticketId].claimedAt = new Date().toISOString(); writeTickets(tickets); }
        await sendDiscordDM(discordId, { title: '✋ Ticket Pris en Charge', description: `Ton ticket est maintenant géré par **${staffName||'Staff'}**.\nTu vas recevoir une réponse très prochainement !`, color: 0x3b82f6, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Support' } });
        return res.json({ success: true });
    }
    if (action === 'close' && ticketId) {
        if (tickets[ticketId]) { tickets[ticketId].status = 'closed'; tickets[ticketId].closedAt = new Date().toISOString(); tickets[ticketId].closedBy = staffName; writeTickets(tickets); }
        await sendDiscordDM(discordId, { title: '🔒 Ticket Fermé', description: `Ton ticket a été fermé par **${staffName||'Staff'}**.\n\nPour une nouvelle demande, utilise \`/ticket\`.`, color: 0x6b7280, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Support' } });
        return res.json({ success: true });
    }

    // Réponse au ticket
    if (staffMessage) {
        if (ticketId && tickets[ticketId]) {
            if (!tickets[ticketId].messages) tickets[ticketId].messages = [];
            tickets[ticketId].messages.push({ from: 'staff', author: staffName||'Staff', content: staffMessage, timestamp: new Date().toISOString() });
            writeTickets(tickets);
        }
        const ok = await sendDiscordDM(discordId, {
            title: `💬 Réponse Staff — ${sujet||'Ticket Support'}`,
            description: staffMessage, color: 0x9333ea,
            timestamp: new Date().toISOString(), footer: { text: `FTY Club Pro | ${staffName||'Staff'}` }
        });
        addBotLog(`💬 Réponse ticket → ${discordId} par ${staffName}`, 'success');
        return res.json({ success: ok });
    }
    res.status(400).json({ error: 'staffMessage requis' });
});

// GET /api/tickets — Liste des tickets pour le panel
app.get('/api/tickets', verifyApiKey, (req, res) => {
    const tickets = Object.values(readTickets()).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ tickets, open: tickets.filter(t => t.status === 'open').length, total: tickets.length });
});

// POST /api/moderate — Modération Discord depuis panel
app.post('/api/moderate', verifyApiKey, async (req, res) => {
    const { action, discordId, reason, moderator } = req.body;
    if (!discordId || !action) return res.status(400).json({ error: 'discordId et action requis' });
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.json({ success: false, error: 'Serveur introuvable' });
        const member = await guild.members.fetch(discordId).catch(() => null);
        const cfg = readConfig();

        const sanctionLog = async (titre, desc, color) => {
            if (cfg.channels?.sanctions) await sendToChannel(cfg.channels.sanctions, { title: titre, description: desc, color, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Modération' } });
        };

        if (action === 'warn') {
            await sendDiscordDM(discordId, { title: '⚠️ Avertissement - FTY Club Pro', description: `**Raison:** ${reason||'Non précisée'}\n**Modérateur:** ${moderator||'Staff'}`, color: 0xf59e0b, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Modération' } });
            await sanctionLog('⚠️ Avertissement', `**Membre:** <@${discordId}>\n**Raison:** ${reason}\n**Modérateur:** ${moderator}`, 0xf59e0b);
            addBotLog(`⚠️ Warn: ${discordId}`, 'warn');
            res.json({ success: true });

        } else if (action === 'kick') {
            if (!member) return res.json({ success: false, error: 'Membre absent du serveur' });
            await sendDiscordDM(discordId, { title: '👢 Expulsion - FTY Club Pro', description: `**Raison:** ${reason||'Non précisée'}\n**Modérateur:** ${moderator||'Staff'}`, color: 0xf97316, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Modération' } }).catch(()=>{});
            await member.kick(reason||'Kick via panel');
            await sanctionLog('👢 Expulsion', `**Membre:** <@${discordId}>\n**Raison:** ${reason}\n**Modérateur:** ${moderator}`, 0xf97316);
            addBotLog(`👢 Kick: ${discordId}`, 'warn');
            res.json({ success: true });

        } else if (action === 'ban') {
            await guild.members.ban(discordId, { reason: reason||'Ban via panel' });
            await sanctionLog('🔨 Bannissement', `**Membre:** <@${discordId}>\n**Raison:** ${reason}\n**Modérateur:** ${moderator}`, 0xef4444);
            addBotLog(`🔨 Ban: ${discordId}`, 'warn');
            res.json({ success: true });

        } else if (action === 'unban') {
            await guild.members.unban(discordId, reason||'Unban via panel');
            addBotLog(`✅ Unban: ${discordId}`, 'success');
            res.json({ success: true });

        } else if (action === 'mute') {
            if (!member) return res.json({ success: false, error: 'Membre absent' });
            if (cfg.roles?.muted) await member.roles.add(cfg.roles.muted);
            await sendDiscordDM(discordId, { title: '🔇 Mute - FTY Club Pro', description: `**Raison:** ${reason||'Non précisée'}\n**Modérateur:** ${moderator||'Staff'}`, color: 0x6b7280, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Modération' } });
            addBotLog(`🔇 Mute: ${discordId}`, 'warn');
            res.json({ success: true });

        } else { res.status(400).json({ error: 'Action inconnue: ' + action }); }

    } catch (e) { addBotLog(`❌ Modération ${action}: ${e.message}`, 'error'); res.json({ success: false, error: e.message }); }
});

// POST /api/notify-poste — Changement de poste/rôle
app.post('/api/notify-poste', verifyApiKey, async (req, res) => {
    const { discordId, username, ancienPoste, nouveauPoste, ancienRole, nouveauRole, by } = req.body;
    const cfg = readConfig();

    // Changer le rôle Discord
    if (discordId && (nouveauRole || ancienRole)) {
        const guild = client.guilds.cache.get(GUILD_ID);
        const member = await guild?.members.fetch(discordId).catch(()=>null);
        if (member) {
            if (ancienRole && cfg.roles[ancienRole]) await member.roles.remove(cfg.roles[ancienRole]).catch(()=>{});
            if (nouveauRole && cfg.roles[nouveauRole]) await member.roles.add(cfg.roles[nouveauRole]).catch(()=>{});
        }
    }

    // DM au membre
    if (discordId) {
        const desc = [
            ancienPoste && nouveauPoste ? `**Poste:** ${ancienPoste} → **${nouveauPoste}**` : nouveauPoste ? `**Nouveau poste:** ${nouveauPoste}` : '',
            ancienRole && nouveauRole ? `**Rôle:** ${ancienRole} → **${nouveauRole}**` : nouveauRole ? `**Nouveau rôle:** ${nouveauRole}` : '',
            by ? `\n**Par:** ${by}` : ''
        ].filter(Boolean).join('\n');
        await sendDiscordDM(discordId, { title: '🎯 Changement de Poste/Rôle - FTY Club Pro', description: desc, color: 0xf472b6, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | RH' } });
    }

    // Annonce salon postes
    if (cfg.channels?.postes) {
        const desc = [username ? `**Membre:** ${username}` : '', ancienPoste && nouveauPoste ? `**Poste:** ${ancienPoste} → **${nouveauPoste}**` : nouveauPoste ? `**Poste:** ${nouveauPoste}` : '', ancienRole && nouveauRole ? `**Rôle:** ${ancienRole} → **${nouveauRole}**` : '', by ? `**Par:** ${by}` : ''].filter(Boolean).join('\n');
        await sendToChannel(cfg.channels.postes, { title: '🎯 Attribution/Changement de Poste', description: desc, color: 0xf472b6, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | RH' } });
    }

    addBotLog(`🎯 Changement poste: ${username} par ${by}`, 'success');
    res.json({ success: true });
});

// POST /api/notify-sanction — Sanction DM + salon
app.post('/api/notify-sanction', verifyApiKey, async (req, res) => {
    const { discordId, username, type, raison, by } = req.body;
    const cfg = readConfig();
    const meta = { warn:{emoji:'⚠️',label:'Avertissement',color:0xf59e0b}, kick:{emoji:'👢',label:'Expulsion',color:0xf97316}, ban:{emoji:'🔨',label:'Bannissement',color:0xef4444}, suspend:{emoji:'⏸️',label:'Suspension',color:0xf59e0b}, mute:{emoji:'🔇',label:'Mute',color:0x6b7280}, unban:{emoji:'✅',label:'Débannissement',color:0x22c55e} }[type] || { emoji:'⚠️',label:type,color:0x9333ea };
    if (discordId) await sendDiscordDM(discordId, { title: `${meta.emoji} ${meta.label} - FTY Club Pro`, description: `**Type:** ${meta.label}\n**Raison:** ${raison||'Non précisée'}\n**Modérateur:** ${by||'Staff'}`, color: meta.color, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Modération' } });
    if (cfg.channels?.sanctions) await sendToChannel(cfg.channels.sanctions, { title: `${meta.emoji} ${meta.label}`, description: `**Membre:** ${username}${discordId?` (<@${discordId}>)`:''}\n**Raison:** ${raison||'Non précisée'}\n**Modérateur:** ${by||'Staff'}`, color: meta.color, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro | Modération' } });
    addBotLog(`${meta.emoji} Sanction ${type}: ${username} par ${by}`, 'warn');
    res.json({ success: true });
});

// POST /api/bot — Route générique actions panel
app.post('/api/bot', verifyApiKey, async (req, res) => {
    const { action, data } = req.body;
    try {
        if (action === 'maintenance') {
            botStatus.maintenanceMode = data?.enabled || false;
            addBotLog(`🔧 Maintenance ${data?.enabled ? 'activée' : 'désactivée'} depuis panel`, 'info');
        } else if (action === 'log') {
            if (data) { botStatus.logs.unshift(data); if (botStatus.logs.length > 1000) botStatus.logs = botStatus.logs.slice(0, 1000); }
        } else if (action === 'updateConfig' || action === 'configUpdate') {
            const cfg = readConfig(); Object.assign(cfg, data||{}); writeConfig(cfg); botStatus.config = cfg;
            addBotLog('🔄 Config mise à jour depuis panel', 'success');
        } else if (action === 'getConfig') {
            return res.json({ success: true, data: readConfig() });
        } else if (action === 'clearLogs') {
            botStatus.logs = []; addBotLog('🗑️ Logs effacés', 'info');
        } else if (action === 'heartbeat') {
            botStatus.panelConnected = true;
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/server-config
app.get('/api/server-config', verifyApiKey, (req, res) => res.json(readConfig()));

// POST /api/server-config — Mise à jour config depuis panel
app.post('/api/server-config', verifyApiKey, (req, res) => {
    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config requis' });
    const updated = { ...readConfig(), ...config };
    writeConfig(updated); botStatus.config = updated;
    addBotLog('🔧 Config serveur mise à jour depuis panel', 'success');
    res.json({ success: true, config: updated });
});

// GET /api/guild-channels et /api/guild-roles pour le panel
app.get('/api/guild-channels', verifyApiKey, async (req, res) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.json({ channels: [] });
    res.json({ channels: guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name, category: c.parent?.name||'Sans catégorie' })) });
});
app.get('/api/guild-roles', verifyApiKey, async (req, res) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.json({ roles: [] });
    res.json({ roles: guild.roles.cache.filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name, color: r.hexColor })) });
});

// GET / et /health
app.get('/', (req, res) => res.json({ status: 'ok', bot: 'FTY Club Pro V5.0', botReady: botStatus.isReady, maintenance: botStatus.maintenanceMode, guilds: botStatus.guilds, members: botStatus.members }));
app.get('/health', (req, res) => res.json({ status: 'ok', botReady: botStatus.isReady, uptime: Date.now() - botStatus.uptime, panelConnected: botStatus.panelConnected }));

// POST /api/send-message — Écrire un message avec le bot depuis le panel
app.post('/api/send-message', verifyApiKey, async (req, res) => {
    const { channelId, message, embed, author } = req.body;
    if (!channelId || (!message && !embed)) return res.status(400).json({ error: 'channelId + message ou embed requis' });
    try {
        const channel = await client.channels.fetch(channelId);
        const opts = {};
        if (embed) {
            opts.embeds = [new EmbedBuilder(embed)];
        } else {
            opts.content = message;
        }
        await channel.send(opts);
        addBotLog(`📢 Message bot envoyé dans #${channel.name} par ${author||'panel'}`, 'success');
        res.json({ success: true });
    } catch (e) {
        addBotLog(`❌ send-message: ${e.message}`, 'error');
        res.json({ success: false, error: e.message });
    }
});

// POST /api/patch-notes — Poster des patch notes dans le salon mises-à-jour
app.post('/api/patch-notes', verifyApiKey, async (req, res) => {
    const { version, title, changes, author } = req.body;
    const cfg = readConfig();
    if (!cfg.channels?.updates) return res.json({ success: false, error: 'Salon mises-à-jour non configuré. Lance /setup.' });
    const changesText = Array.isArray(changes) ? changes.map((c, i) => `${i+1}. ${c}`).join('\n') : (changes || 'Améliorations générales');
    const ok = await sendToChannel(cfg.channels.updates, {
        title: `🔄 Mise à jour ${version || ''} — FTY Club Pro`,
        description: `**${title || 'Nouvelles Mises à Jour'}**\n\n${changesText}`,
        color: 0x3b82f6,
        timestamp: new Date().toISOString(),
        footer: { text: `FTY Club Pro | Patch Notes${author ? ` | Par ${author}` : ''}` }
    });
    addBotLog(`🔄 Patch notes v${version} publiés par ${author||'panel'}`, 'success');
    res.json({ success: ok });
});

// POST /api/nuke-all — DANGER: Nuke complet (Xywez uniquement)
app.post('/api/nuke-all', verifyApiKey, async (req, res) => {
    const { xywezId, confirm } = req.body;
    if (xywezId !== SUPER_ADMIN_DISCORD_ID || confirm !== 'NUKE_CONFIRM_FTY_2026') {
        return res.status(403).json({ error: 'Action non autorisée. Réservé à Xywez uniquement avec confirmation.' });
    }
    addBotLog('☢️ NUKE ALL initié par Xywez', 'error');
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.json({ success: false, error: 'Serveur introuvable' });
        // Supprimer tous les salons
        const channels = [...guild.channels.cache.values()];
        for (const ch of channels) {
            await ch.delete('Nuke All by Xywez').catch(()=>{});
        }
        // Supprimer tous les rôles (sauf @everyone et les rôles system)
        const roles = [...guild.roles.cache.values()].filter(r => !r.managed && r.name !== '@everyone' && r.position < guild.members.me.roles.highest.position);
        for (const r of roles) {
            await r.delete('Nuke All by Xywez').catch(()=>{});
        }
        // Reset la config locale
        const emptyConfig = { configured: false, categories: {}, channels: { general: null, annonces: null, matchAnnonce: null, sanctions: null, postes: null, logs: null, bienvenue: null, reglement: null, recrutement: null, guide: null, officialAnnonces: null, giveaway: null, updates: null, tickets: null }, roles: { owner: null, admin: null, moderateur: null, support: null, capitaine: null, joueur: null, membre: null, muted: null }, antiRaid: { enabled: false }, antiLink: { enabled: false }, antiDouble: { enabled: false } };
        writeConfig(emptyConfig);
        const emptyTickets = {};
        writeTickets(emptyTickets);
        // Notifier le panel de reset la DB
        await sendToPanel('nukeReset', { by: 'Xywez', timestamp: new Date().toISOString() });
        addBotLog('☢️ NUKE ALL terminé — Server + Config reset', 'error');
        res.json({ success: true, message: 'Nuke complet effectué. Lance /setup pour reconfigurer.' });
    } catch(e) {
        addBotLog(`❌ Nuke all error: ${e.message}`, 'error');
        res.json({ success: false, error: e.message });
    }
});

// ============================================================
// ===           ERREURS DISCORD                            ===
// ============================================================
client.on('error', err => addBotLog(`❌ Erreur client: ${err.message}`, 'error'));
client.on('warn', info => addBotLog(`⚠️ Warning: ${info}`, 'warn'));

// ============================================================
// ===           DÉMARRAGE                                  ===
// ============================================================
app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║        🤖  FTY CLUB PRO - BOT DISCORD V4.0  🤖          ║');
    console.log(`║   📡  API:    http://localhost:${PORT}                      ║`);
    console.log(`║   🔗  Panel:  ${PANEL_URL.substring(0,40).padEnd(40)} ║`);
    console.log(`║   👑  Owner:  Xywez (${SUPER_ADMIN_DISCORD_ID})       ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  Commandes: /site  /status(owner)  /setup(owner)  /ticket║');
    console.log('║  Systèmes:  Anti-Raid | Anti-Link | Anti-Double Compte  ║');
    console.log('║  Tickets:   DM ↔ Panel (staff/modérateur/support+)     ║');
    console.log('║  Annonces:  Match | Sanctions | Postes → depuis panel   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
});

console.log('🔄 Connexion Discord...');
client.login(DISCORD_BOT_TOKEN).catch(err => {
    console.error('❌ ERREUR CONNEXION BOT:', err.message);
    console.error('→ Vérifiez DISCORD_BOT_TOKEN et les Privileged Intents sur discord.com/developers');
    process.exit(1);
});

process.on('SIGTERM', () => { console.log('📴 SIGTERM'); client.destroy(); process.exit(0); });
process.on('SIGINT',  () => { console.log('📴 SIGINT');  client.destroy(); process.exit(0); });
process.on('uncaughtException',  err => addBotLog(`❌ Exception: ${err.message}`, 'error'));
process.on('unhandledRejection', r   => addBotLog(`❌ Promise: ${String(r)}`,    'error'));