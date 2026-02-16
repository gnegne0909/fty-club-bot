const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, REST, Routes, ActivityType } = require('discord.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================
// ===           CONFIGURATION                              ===
// ============================================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = '1471212577957613762';
const SUPER_ADMIN_DISCORD_ID = '969065205067825222'; // Xywez
const PANEL_URL = process.env.PANEL_URL || 'https://fty-club-pro-1.onrender.com';
const PANEL_API_KEY = process.env.PANEL_API_KEY || 'fty-secret-api-key-2026';
const PORT = process.env.PORT || 3001;

// ============================================================
// ===           GÉO-IP CONFIG                             ===
// ============================================================
const GEOIP_APIS = [
    'http://ip-api.com/json/',
    'https://ipapi.co/',
];

async function getGeoIP(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
        return { country: 'Local', city: 'Localhost', isp: 'Local Network', emoji: '🏠', lat: null, lon: null };
    }
    try {
        const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,lat,lon,proxy,hosting`, { timeout: 3000 });
        const d = res.data;
        if (d.status === 'success') {
            const flagEmoji = d.countryCode ? d.countryCode.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65)) : '🌍';
            return {
                country: d.country || 'Unknown',
                countryCode: d.countryCode || '??',
                city: d.city || 'Unknown',
                isp: d.isp || 'Unknown',
                emoji: flagEmoji,
                lat: d.lat,
                lon: d.lon,
                proxy: d.proxy || false,
                hosting: d.hosting || false
            };
        }
    } catch (e) {}
    return { country: 'Unknown', city: 'Unknown', isp: 'Unknown', emoji: '🌍', lat: null, lon: null };
}

// ============================================================
// ===           INITIALISATION BOT                         ===
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
    partials: ['CHANNEL', 'MESSAGE']
});

let botStatus = {
    status: 'online',
    activity: { name: 'FTY Club Pro | /site', type: 0 },
    isReady: false,
    guilds: 0,
    members: 0,
    uptime: Date.now(),
    logs: [],
    commands: [],
    maintenanceMode: false
};

let serverConfig = {
    configured: false,
    categories: {},
    channels: {},
    roles: {}
};

// ============================================================
// ===           COMMANDES SLASH                            ===
// ============================================================
const commands = [
    {
        name: 'setup',
        description: '⚙️ Configure automatiquement tout le serveur (Réservé Owner)',
    },
    {
        name: 'nuke',
        description: '💣 Supprime tous les messages du salon (Réservé Xywez uniquement)',
    },
    {
        name: 'site',
        description: '🌐 Affiche le lien du site web FTY Club Pro',
    },
    {
        name: 'ban',
        description: '🔨 Bannir un membre',
        options: [
            { name: 'utilisateur', description: 'Membre à bannir', type: 6, required: true },
            { name: 'raison', description: 'Raison du bannissement', type: 3, required: false }
        ]
    },
    {
        name: 'kick',
        description: '👢 Expulser un membre',
        options: [
            { name: 'utilisateur', description: 'Membre à expulser', type: 6, required: true },
            { name: 'raison', description: "Raison de l'expulsion", type: 3, required: false }
        ]
    },
    {
        name: 'announce',
        description: '📢 Créer une annonce',
        options: [
            {
                name: 'type', description: "Type d'annonce", type: 3, required: true,
                choices: [
                    { name: 'Global', value: 'global' }, { name: 'Match', value: 'match' },
                    { name: 'Conférence', value: 'conference' }, { name: 'Recrutement', value: 'recrutement' }
                ]
            },
            { name: 'message', description: "Contenu de l'annonce", type: 3, required: true }
        ]
    },
    {
        name: 'ticket',
        description: '🎫 Ouvrir un ticket de support',
        options: [{ name: 'sujet', description: 'Sujet du ticket', type: 3, required: true }]
    },
    {
        name: 'status',
        description: '📊 Affiche les statistiques du bot',
    },
    {
        name: 'maintenance',
        description: '🔧 Activer/désactiver le mode maintenance (Xywez uniquement)',
        options: [
            {
                name: 'action', description: 'Action', type: 3, required: true,
                choices: [{ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' }]
            },
            { name: 'message', description: 'Message de maintenance', type: 3, required: false }
        ]
    },
    {
        name: 'blockip',
        description: '🚫 Bloquer une IP (Owner+)',
        options: [
            { name: 'ip', description: "IP à bloquer", type: 3, required: true },
            { name: 'raison', description: "Raison", type: 3, required: false }
        ]
    },
    {
        name: 'whitelistip',
        description: '✅ Whitelister une IP (Xywez uniquement)',
        options: [
            { name: 'ip', description: "IP à whitelister", type: 3, required: true }
        ]
    },
    {
        name: 'lookup',
        description: '🔍 Info géo-IP sur une adresse (Owner+)',
        options: [
            { name: 'ip', description: "IP à analyser", type: 3, required: true }
        ]
    }
];

// ============================================================
// ===           FONCTIONS UTILITAIRES                      ===
// ============================================================
function addBotLog(message, ip = null, geoData = null) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        message: message,
        ip: ip || null,
        geo: geoData || null
    };
    botStatus.logs.unshift(logEntry);
    if (botStatus.logs.length > 500) botStatus.logs = botStatus.logs.slice(0, 500);
    const geoStr = geoData ? ` [${geoData.emoji} ${geoData.city}, ${geoData.country}]` : '';
    const ipStr = ip ? ` (IP: ${ip})` : '';
    console.log(`[${new Date().toLocaleTimeString()}] ${message}${ipStr}${geoStr}`);
    sendToPanel('log', logEntry).catch(() => {});
}

function updateBotStatus(status, activityName, activityType) {
    if (!client.user) return false;
    try {
        botStatus.status = status;
        botStatus.activity = { name: activityName, type: activityType };
        client.user.setPresence({
            status: status,
            activities: [{ name: activityName, type: activityType }]
        });
        addBotLog(`Statut changé: ${status} - ${activityName}`);
        return true;
    } catch (error) {
        console.error('Erreur changement statut:', error);
        return false;
    }
}

function saveServerConfig() {
    try {
        fs.writeFileSync(path.join(__dirname, 'server-config.json'), JSON.stringify(serverConfig, null, 2));
    } catch (error) { console.error('Erreur sauvegarde config:', error); }
}

function loadServerConfig() {
    try {
        const configFile = path.join(__dirname, 'server-config.json');
        if (fs.existsSync(configFile)) {
            serverConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            console.log('✅ Configuration serveur chargée');
        }
    } catch (error) { console.error('Erreur chargement config:', error); }
}

async function sendToPanel(action, data) {
    try {
        await axios.post(`${PANEL_URL}/api/bot`, {
            apiKey: PANEL_API_KEY, action, data
        }, { timeout: 5000 });
    } catch (error) {}
}

async function sendDiscordDM(discordId, embed) {
    try {
        const user = await client.users.fetch(discordId);
        await user.send({ embeds: [embed] });
        return true;
    } catch (e) {
        console.error(`Impossible d'envoyer DM à ${discordId}:`, e.message);
        return false;
    }
}

function getClientIP(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) {
        const first = fwd.split(',')[0].trim();
        if (first.startsWith('::ffff:')) return first.replace('::ffff:', '');
        if (first !== '::1' && first !== '127.0.0.1') return first;
    }
    const real = req.headers['x-real-ip'];
    if (real) return real.replace('::ffff:', '');
    const r = (req.connection && req.connection.remoteAddress) || (req.socket && req.socket.remoteAddress) || 'unknown';
    return r.replace('::ffff:', '').replace('::1', '127.0.0.1');
}

// ============================================================
// ===           SETUP COMMANDES DISCORD                    ===
// ============================================================
async function registerCommands() {
    if (!DISCORD_BOT_TOKEN) return;
    try {
        const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_APP_ID || '1470568087966187541', GUILD_ID), { body: commands });
        console.log('✅ Commandes slash enregistrées');
        botStatus.commands = commands.map(c => c.name);
    } catch (error) {
        console.error('❌ Erreur enregistrement commandes:', error.message);
    }
}

const DISCORD_CLIENT_APP_ID = process.env.DISCORD_CLIENT_APP_ID || '1470568087966187541';

// ============================================================
// ===           EVENTS BOT                                 ===
// ============================================================
client.once('ready', async () => {
    console.log(`✅ Bot connecté: ${client.user.tag}`);
    botStatus.isReady = true;
    botStatus.guilds = client.guilds.cache.size;
    const allMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    botStatus.members = allMembers;

    client.user.setPresence({
        status: 'online',
        activities: [{ name: 'FTY Club Pro | /site', type: ActivityType.Playing }]
    });

    loadServerConfig();
    await registerCommands();
    addBotLog('🚀 Bot FTY Club Pro démarré avec succès');

    setInterval(() => {
        botStatus.guilds = client.guilds.cache.size;
        botStatus.members = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    }, 60000);
});

// Anti-raid : suivi des jointures
const recentJoins = {};

client.on('guildMemberAdd', async member => {
    const now = Date.now();
    const guildId = member.guild.id;
    if (!recentJoins[guildId]) recentJoins[guildId] = [];
    recentJoins[guildId].push(now);
    recentJoins[guildId] = recentJoins[guildId].filter(t => now - t < 10000);

    addBotLog(`👤 Nouveau membre: ${member.user.tag} (${member.id})`);

    try {
        const panelData = await callPanelAPI('/api/bot-config');
        const antiRaid = (panelData && panelData.antiRaid) || { enabled: true, joinThreshold: 5, timeWindow: 10 };
        if (antiRaid.enabled && recentJoins[guildId].length >= (antiRaid.joinThreshold || 5)) {
            await member.kick('Anti-Raid: afflux anormal de membres').catch(() => {});
            addBotLog(`🛡️ Anti-Raid: ${member.user.tag} expulsé (afflux détecté)`);
        }
    } catch (e) {}

    try {
        const dm = new EmbedBuilder()
            .setColor('#9333ea')
            .setTitle('⚽ Bienvenue sur FTY Club Pro !')
            .setDescription('Bienvenue dans notre communauté ! Consulte notre site pour en savoir plus.')
            .addFields({ name: '🌐 Site Web', value: PANEL_URL })
            .setFooter({ text: 'FTY Club Pro' })
            .setTimestamp();
        await member.send({ embeds: [dm] });
    } catch (e) {}
});

async function callPanelAPI(endpoint) {
    try {
        const res = await axios.get(`${PANEL_URL}${endpoint}`, {
            headers: { 'x-api-key': PANEL_API_KEY }, timeout: 3000
        });
        return res.data;
    } catch (e) { return null; }
}

// ============================================================
// ===           INTERACTION HANDLER                        ===
// ============================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const ip = null; // Pas d'IP disponible côté Discord
    const { commandName, user } = interaction;
    const isXywez = user.id === SUPER_ADMIN_DISCORD_ID;

    try {
        if (commandName === 'site') {
            const embed = new EmbedBuilder()
                .setColor('#9333ea')
                .setTitle('🌐 FTY Club Pro - Site Officiel')
                .setDescription(`Rejoins notre plateforme officielle !\n\n🔗 **${PANEL_URL}**`)
                .addFields(
                    { name: '📱 Accès rapide', value: `[Clique ici pour visiter](${PANEL_URL})`, inline: true },
                    { name: '🎮 Rejoindre', value: `[S'inscrire](${PANEL_URL}/register)`, inline: true }
                )
                .setFooter({ text: 'FTY Club Pro' })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            addBotLog(`🌐 /site utilisé par ${user.tag}`);
        }

        else if (commandName === 'status') {
            const days = Math.floor((Date.now() - botStatus.uptime) / 86400000);
            const hours = Math.floor(((Date.now() - botStatus.uptime) % 86400000) / 3600000);
            const minutes = Math.floor(((Date.now() - botStatus.uptime) % 3600000) / 60000);
            const embed = new EmbedBuilder()
                .setColor('#22c55e')
                .setTitle('📊 Statistiques du Bot')
                .addFields(
                    { name: 'Statut', value: botStatus.isReady ? '🟢 En ligne' : '🔴 Hors ligne', inline: true },
                    { name: 'Serveurs', value: `${botStatus.guilds}`, inline: true },
                    { name: 'Membres', value: `${botStatus.members}`, inline: true },
                    { name: 'Uptime', value: `${days}j ${hours}h ${minutes}m`, inline: true },
                    { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
                    { name: 'Maintenance', value: botStatus.maintenanceMode ? '🔧 Activée' : '✅ Off', inline: true }
                )
                .setFooter({ text: 'FTY Club Pro' })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }

        else if (commandName === 'maintenance') {
            if (!isXywez) return interaction.reply({ content: '❌ Réservé à Xywez uniquement.', ephemeral: true });
            const action = interaction.options.getString('action');
            const msg = interaction.options.getString('message') || 'Maintenance en cours...';
            botStatus.maintenanceMode = action === 'on';
            await sendToPanel('maintenance', { enabled: action === 'on', message: msg });
            addBotLog(`🔧 Mode maintenance: ${action} par ${user.tag}`);
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(action === 'on' ? '#f59e0b' : '#22c55e')
                    .setTitle(action === 'on' ? '🔧 Maintenance Activée' : '✅ Maintenance Désactivée')
                    .setDescription(action === 'on' ? `**Message:** ${msg}` : 'Le site est de nouveau accessible.')
                    .setFooter({ text: 'FTY Club Pro - Admin' })
                    .setTimestamp()]
            });
        }

        else if (commandName === 'blockip') {
            const member = interaction.guild?.members.cache.get(user.id);
            const isOwner = isXywez || (member && member.roles.cache.some(r => r.name.toLowerCase().includes('owner')));
            if (!isOwner) return interaction.reply({ content: '❌ Réservé aux Owners+.', ephemeral: true });
            const ipToBlock = interaction.options.getString('ip');
            const reason = interaction.options.getString('raison') || 'Bloqué via Discord';
            await sendToPanel('blockip', { ip: ipToBlock, reason, blockedBy: user.tag });
            addBotLog(`🚫 IP bloquée: ${ipToBlock} par ${user.tag} - ${reason}`);
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ef4444')
                    .setTitle('🚫 IP Bloquée')
                    .addFields(
                        { name: 'IP', value: ipToBlock, inline: true },
                        { name: 'Raison', value: reason, inline: true },
                        { name: 'Par', value: user.tag, inline: true }
                    )
                    .setTimestamp()], ephemeral: true
            });
        }

        else if (commandName === 'whitelistip') {
            if (!isXywez) return interaction.reply({ content: '❌ Réservé à Xywez uniquement.', ephemeral: true });
            const ipToWhite = interaction.options.getString('ip');
            await sendToPanel('whitelistip', { ip: ipToWhite, addedBy: user.tag });
            addBotLog(`✅ IP whitelistée: ${ipToWhite} par ${user.tag}`);
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#22c55e')
                    .setTitle('✅ IP Whitelistée')
                    .addFields({ name: 'IP', value: ipToWhite, inline: true })
                    .setTimestamp()], ephemeral: true
            });
        }

        else if (commandName === 'lookup') {
            const member = interaction.guild?.members.cache.get(user.id);
            const isOwner = isXywez || (member && member.roles.cache.some(r => r.name.toLowerCase().includes('owner')));
            if (!isOwner) return interaction.reply({ content: '❌ Réservé aux Owners+.', ephemeral: true });
            const ipToLook = interaction.options.getString('ip');
            await interaction.deferReply({ ephemeral: true });
            const geo = await getGeoIP(ipToLook);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#9333ea')
                    .setTitle(`🔍 Géo-IP: ${ipToLook}`)
                    .addFields(
                        { name: 'Pays', value: `${geo.emoji} ${geo.country}`, inline: true },
                        { name: 'Ville', value: geo.city, inline: true },
                        { name: 'FAI', value: geo.isp, inline: true },
                        { name: 'Proxy/VPN', value: geo.proxy ? '⚠️ Oui' : '✅ Non', inline: true },
                        { name: 'Hébergeur', value: geo.hosting ? '⚠️ Oui' : '✅ Non', inline: true },
                        { name: 'Coordonnées', value: geo.lat ? `${geo.lat}, ${geo.lon}` : 'N/A', inline: true }
                    )
                    .setTimestamp()]
            });
        }

        else if (commandName === 'nuke') {
            if (!isXywez) return interaction.reply({ content: '❌ Réservé à Xywez uniquement.', ephemeral: true });
            const channel = interaction.channel;
            if (!channel) return interaction.reply({ content: '❌ Salon introuvable.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            let deleted = 0;
            while (true) {
                const msgs = await channel.messages.fetch({ limit: 100 });
                if (msgs.size === 0) break;
                const deletable = msgs.filter(m => Date.now() - m.createdTimestamp < 1209600000);
                if (deletable.size === 0) break;
                await channel.bulkDelete(deletable);
                deleted += deletable.size;
                if (deletable.size < 100) break;
            }
            addBotLog(`💣 Nuke par ${user.tag}: ${deleted} messages supprimés`);
            await interaction.editReply({ content: `✅ ${deleted} messages supprimés.` });
        }

        else if (commandName === 'ban') {
            const target = interaction.options.getMember('utilisateur');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            if (!target) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            }
            try {
                await target.ban({ reason: `${reason} | Par: ${user.tag}` });
                addBotLog(`🔨 Ban: ${target.user.tag} par ${user.tag} - ${reason}`);
                await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ef4444').setTitle('🔨 Membre Banni').addFields({ name: 'Membre', value: target.user.tag }, { name: 'Raison', value: reason }).setTimestamp()] });
            } catch (e) { await interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true }); }
        }

        else if (commandName === 'kick') {
            const target = interaction.options.getMember('utilisateur');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            if (!target) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
            if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
                return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
            }
            try {
                await target.kick(`${reason} | Par: ${user.tag}`);
                addBotLog(`👢 Kick: ${target.user.tag} par ${user.tag} - ${reason}`);
                await interaction.reply({ embeds: [new EmbedBuilder().setColor('#f59e0b').setTitle('👢 Membre Expulsé').addFields({ name: 'Membre', value: target.user.tag }, { name: 'Raison', value: reason }).setTimestamp()] });
            } catch (e) { await interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true }); }
        }

        else if (commandName === 'announce') {
            const type = interaction.options.getString('type');
            const message = interaction.options.getString('message');
            const typeMap = {
                global: { emoji: '📢', color: '#3b82f6', key: 'annonces-globales' },
                match: { emoji: '⚽', color: '#22c55e', key: 'annonces-matchs' },
                conference: { emoji: '🎤', color: '#a855f7', key: 'conférences' },
                recrutement: { emoji: '🎯', color: '#f59e0b', key: 'recrutement' }
            };
            const cfg = typeMap[type] || typeMap.global;
            const chanId = serverConfig.channels?.[cfg.key];
            if (!chanId) return interaction.reply({ content: '❌ Salon introuvable. Faites /setup d\'abord.', ephemeral: true });
            const channel = interaction.guild?.channels.cache.get(chanId);
            if (!channel) return interaction.reply({ content: '❌ Salon Discord introuvable.', ephemeral: true });
            const embed = new EmbedBuilder()
                .setColor(cfg.color)
                .setTitle(`${cfg.emoji} Annonce ${type.toUpperCase()}`)
                .setDescription(message)
                .setFooter({ text: `FTY Club Pro • Par ${user.tag}` })
                .setTimestamp();
            await channel.send({ content: '@everyone', embeds: [embed] });
            addBotLog(`📢 Annonce ${type} par ${user.tag}`);
            await interaction.reply({ content: '✅ Annonce envoyée !', ephemeral: true });
        }

        else if (commandName === 'ticket') {
            const sujet = interaction.options.getString('sujet');
            addBotLog(`🎫 Ticket ouvert par ${user.tag}: ${sujet}`);
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#3b82f6')
                    .setTitle('🎫 Ticket Ouvert')
                    .setDescription(`**Sujet:** ${sujet}\nUn membre du staff vous contactera prochainement.`)
                    .setFooter({ text: 'FTY Club Pro Support' })
                    .setTimestamp()],
                ephemeral: true
            });
            await sendToPanel('ticket', { discordId: user.id, discordTag: user.tag, sujet });
        }

        else if (commandName === 'setup') {
            if (!isXywez) return interaction.reply({ content: '❌ Réservé aux Owners.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const guild = interaction.guild;
            addBotLog(`⚙️ Setup lancé par ${user.tag}`);
            await interaction.editReply({ content: '✅ Setup en cours... (voir logs)' });
        }
    } catch (err) {
        console.error(`❌ Erreur commande ${commandName}:`, err.message);
        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: '❌ Une erreur est survenue.' });
            } else if (!interaction.replied) {
                await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true });
            }
        } catch (e) {}
    }
});

// Anti-lien dans les messages
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.GuildText) return;
    const urlRegex = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/gi;
    if (urlRegex.test(message.content)) {
        const member = message.guild?.members.cache.get(message.author.id);
        const isStaff = member?.roles.cache.some(r =>
            ['owner', 'fondateur', 'cofondateur', 'manager', 'administrateur', 'moderateur'].some(s => r.name.toLowerCase().includes(s))
        );
        if (!isStaff) {
            try {
                await message.delete();
                const warn = new EmbedBuilder()
                    .setColor('#f59e0b')
                    .setTitle('⚠️ Lien Supprimé')
                    .setDescription(`${message.author}, les liens ne sont pas autorisés ici.`)
                    .setFooter({ text: 'FTY Club Pro Anti-Link' });
                const msg = await message.channel.send({ embeds: [warn] });
                setTimeout(() => msg.delete().catch(() => {}), 5000);
                addBotLog(`🔗 Anti-link: ${message.author.tag} - lien supprimé`);
            } catch (e) {}
        }
    }
});

// ============================================================
// ===           API EXPRESS POUR PANEL                     ===
// ============================================================
const app = express();
app.use(express.json());

function verifyApiKey(req, res, next) {
    const apiKey = req.body?.apiKey || req.headers['x-api-key'];
    if (apiKey !== PANEL_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
    next();
}

app.get('/api/status', verifyApiKey, (req, res) => {
    res.json(botStatus);
});

app.post('/api/update-status', verifyApiKey, (req, res) => {
    const { status, activity, activityType } = req.body;
    if (!botStatus.isReady) return res.status(503).json({ error: 'Bot not connected' });
    const success = updateBotStatus(status, activity, parseInt(activityType));
    if (success) res.json({ success: true, botStatus });
    else res.status(500).json({ error: 'Failed to update status' });
});

app.post('/api/send-dm', verifyApiKey, async (req, res) => {
    const { discordId, embed } = req.body;
    if (!discordId || !embed) return res.status(400).json({ error: 'Missing discordId or embed' });
    try {
        const discordEmbed = new EmbedBuilder(embed);
        const success = await sendDiscordDM(discordId, discordEmbed);
        res.json({ success });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/check-permission', verifyApiKey, (req, res) => {
    res.json({ hasPermission: true });
});

app.post('/api/announce', verifyApiKey, async (req, res) => {
    const { type, message } = req.body;
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
        const typeMap = {
            global: { emoji: '📢', color: '#3b82f6', key: 'annonces-globales' },
            match: { emoji: '⚽', color: '#22c55e', key: 'annonces-matchs' },
            conference: { emoji: '🎤', color: '#a855f7', key: 'conférences' },
            recrutement: { emoji: '🎯', color: '#f59e0b', key: 'recrutement' }
        };
        const cfg = typeMap[type] || typeMap.global;
        const chanId = serverConfig.channels?.[cfg.key];
        if (!chanId) return res.status(404).json({ error: 'Salon introuvable. Faites /setup d\'abord.' });
        const channel = guild.channels.cache.get(chanId);
        if (!channel) return res.status(404).json({ error: 'Salon Discord introuvable' });
        const embed = new EmbedBuilder()
            .setColor(cfg.color)
            .setTitle(`${cfg.emoji} Annonce ${type.toUpperCase()}`)
            .setDescription(message)
            .setFooter({ text: 'FTY Club Pro' })
            .setTimestamp();
        await channel.send({ content: '@everyone', embeds: [embed] });
        addBotLog(`📢 Annonce ${type} envoyée depuis le panel`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ticket', verifyApiKey, async (req, res) => {
    const { discordId, sujet, staffMessage } = req.body;
    try {
        const member = await client.users.fetch(discordId);
        const embed = new EmbedBuilder()
            .setColor('#3b82f6')
            .setTitle('🎫 Message du Staff - FTY Club Pro')
            .setDescription(`**Sujet:** ${sujet}\n\n${staffMessage || 'Un membre du staff vous contacte.'}`)
            .setFooter({ text: 'FTY Club Pro Support' })
            .setTimestamp();
        await member.send({ embeds: [embed] });
        addBotLog(`🎫 Ticket DM -> ${member.tag}: ${sujet}`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/moderate', verifyApiKey, async (req, res) => {
    const { action, discordId, reason, moderator } = req.body;
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Membre introuvable sur Discord' });
        const embed = new EmbedBuilder()
            .setColor({ ban: '#ef4444', kick: '#f59e0b', warn: '#f59e0b' }[action] || '#888')
            .setTitle({ ban: '🔨 Vous avez été banni', kick: '👢 Vous avez été expulsé', warn: '⚠️ Avertissement' }[action] || '📋 Action Staff')
            .setDescription(`**Raison:** ${reason || 'Aucune raison'}\n**Par:** ${moderator || 'Staff'}`)
            .setTimestamp();
        try { await member.send({ embeds: [embed] }); } catch {}
        if (action === 'ban') await member.ban({ reason: `${reason || ''} | ${moderator || 'Panel'}` });
        else if (action === 'kick') await member.kick(`${reason || ''} | ${moderator || 'Panel'}`);
        addBotLog(`🔨 ${action.toUpperCase()} Discord: ${discordId} par ${moderator || 'panel'}`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Endpoint pour recevoir les actions du panel (maintenance, blockip, etc.)
app.post('/api/bot', verifyApiKey, async (req, res) => {
    const { action, data } = req.body;
    try {
        if (action === 'maintenance') {
            botStatus.maintenanceMode = data?.enabled || false;
            addBotLog(`🔧 Maintenance ${data?.enabled ? 'activée' : 'désactivée'} depuis panel`);
        } else if (action === 'log') {
            // Log reçu du panel
            if (data) {
                botStatus.logs.unshift(data);
                if (botStatus.logs.length > 500) botStatus.logs = botStatus.logs.slice(0, 500);
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Géo-IP lookup depuis panel
app.post('/api/geoip', verifyApiKey, async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP manquante' });
    const geo = await getGeoIP(ip);
    res.json(geo);
});

app.get('/api/logs', verifyApiKey, (req, res) => {
    res.json({ logs: botStatus.logs });
});

app.post('/api/execute-command', verifyApiKey, async (req, res) => {
    const { command, guildId, channelId, userId } = req.body;
    if (userId !== SUPER_ADMIN_DISCORD_ID) return res.status(403).json({ error: 'Forbidden' });
    try {
        const guild = client.guilds.cache.get(guildId || GUILD_ID);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });
        addBotLog(`Commande exécutée depuis panel par ${userId}: ${command}`);
        res.json({ success: true, message: 'Command executed' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', bot: 'FTY Club Pro', botReady: botStatus.isReady, maintenance: botStatus.maintenanceMode });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', botReady: botStatus.isReady, uptime: Date.now() - botStatus.uptime });
});

// ============================================================
// ===           DÉMARRAGE                                  ===
// ============================================================
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        🤖  FTY CLUB PRO - BOT DISCORD V3.0  🤖          ║
║                                                          ║
║   📡  API:    http://localhost:${PORT}                   ║
║   🔗  Panel:  ${PANEL_URL}
║                                                          ║
║   👑  Owner: Xywez (Nytrox692 / ${SUPER_ADMIN_DISCORD_ID})  ║
║   🆔  Guild ID: ${GUILD_ID}                             ║
║                                                          ║
║   ⚡  V3 Features:                                       ║
║   • Géo-IP dans les logs                                 ║
║   • Block IP / Whitelist IP via Discord                  ║
║   • Mode Maintenance via /maintenance                    ║
║   • /lookup pour analyser une IP                         ║
║   • Anti-raid & Anti-link                                ║
║   • Communication panel bidirectionnelle                 ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
    `);
});

if (DISCORD_BOT_TOKEN) {
    client.login(DISCORD_BOT_TOKEN).catch(err => {
        console.error('❌ Erreur de connexion du bot:', err.message);
        addBotLog('Erreur de connexion: ' + err.message);
    });
} else {
    console.error('❌ DISCORD_BOT_TOKEN non défini!');
    console.log("⚠️  Veuillez définir la variable d'environnement DISCORD_BOT_TOKEN");
}
