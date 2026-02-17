const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType, REST, Routes, ActivityType } = require('discord.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================
// ===           CONFIGURATION AVEC VALIDATION             ===
// ============================================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_APP_ID = process.env.DISCORD_CLIENT_APP_ID || '1470568087966187541';
const GUILD_ID = process.env.GUILD_ID || '1471212577957613762';
const SUPER_ADMIN_DISCORD_ID = '969065205067825222'; // Xywez
const PANEL_URL = process.env.PANEL_URL || 'https://fty-club-pro-1.onrender.com';
const PANEL_API_KEY = process.env.PANEL_API_KEY || 'fty-secret-api-key-2026';
const PORT = process.env.PORT || 3001;

// Validation critique
if (!DISCORD_BOT_TOKEN) {
    console.error('');
    console.error('╔═══════════════════════════════════════════════════════════╗');
    console.error('║  ❌ ERREUR CRITIQUE: DISCORD_BOT_TOKEN NON DÉFINI        ║');
    console.error('╚═══════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('⚠️  Actions requises sur Render:');
    console.error('   1. Allez dans Settings > Environment');
    console.error('   2. Ajoutez: DISCORD_BOT_TOKEN = votre_token_bot');
    console.error('   3. Redémarrez le service');
    console.error('');
    process.exit(1);
}

console.log('✅ Configuration validée');
console.log(`   • Port: ${PORT}`);
console.log(`   • Panel: ${PANEL_URL}`);
console.log(`   • Guild ID: ${GUILD_ID}`);
console.log(`   • App ID: ${DISCORD_CLIENT_APP_ID}`);

// ============================================================
// ===           GÉO-IP                                    ===
// ============================================================
const GEOIP_CACHE = {};

async function getGeoIP(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
        return { country: 'Local', city: 'Localhost', isp: 'Local Network', emoji: '🏠', lat: null, lon: null };
    }
    
    if (GEOIP_CACHE[ip] && Date.now() - GEOIP_CACHE[ip].ts < 3600000) {
        return GEOIP_CACHE[ip].data;
    }
    
    try {
        const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,lat,lon,proxy,hosting`, { 
            timeout: 5000,
            validateStatus: status => status === 200
        });
        const d = res.data;
        if (d && d.status === 'success') {
            const flagEmoji = d.countryCode ? d.countryCode.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65)) : '🌍';
            const geoData = {
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
            GEOIP_CACHE[ip] = { data: geoData, ts: Date.now() };
            return geoData;
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
    maintenanceMode: false,
    panelConnected: false
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
        name: 'site',
        description: '🌐 Affiche le lien du site web FTY Club Pro',
    },
    {
        name: 'status',
        description: '📊 Affiche les statistiques du bot (Xywez uniquement)',
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
    if (!client.user) {
        console.log('⚠️  Cannot update status: bot not ready');
        return false;
    }
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
        console.error('❌ Erreur changement statut:', error.message);
        return false;
    }
}

function saveServerConfig() {
    try {
        const configPath = path.join(__dirname, 'server-config.json');
        fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2));
        console.log('✅ Config serveur sauvegardée');
    } catch (error) { 
        console.error('❌ Erreur sauvegarde config:', error.message); 
    }
}

function loadServerConfig() {
    try {
        const configFile = path.join(__dirname, 'server-config.json');
        if (fs.existsSync(configFile)) {
            serverConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            console.log('✅ Configuration serveur chargée');
        } else {
            console.log('ℹ️  Aucune config serveur trouvée');
        }
    } catch (error) { 
        console.error('❌ Erreur chargement config:', error.message); 
    }
}

async function sendToPanel(action, data) {
    try {
        await axios.post(`${PANEL_URL}/api/bot`, {
            apiKey: PANEL_API_KEY, 
            action, 
            data
        }, { 
            timeout: 5000,
            validateStatus: status => status < 500
        });
        botStatus.panelConnected = true;
    } catch (error) {
        botStatus.panelConnected = false;
    }
}

async function sendDiscordDM(discordId, embed) {
    try {
        const user = await client.users.fetch(discordId);
        await user.send({ embeds: [embed] });
        return true;
    } catch (e) {
        console.error(`❌ Impossible d'envoyer DM à ${discordId}:`, e.message);
        return false;
    }
}

// ============================================================
// ===           SETUP COMMANDES DISCORD                    ===
// ============================================================
async function registerCommands() {
    if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_APP_ID) {
        console.error('❌ Cannot register commands: missing TOKEN or APP_ID');
        return;
    }
    
    try {
        console.log('📝 Enregistrement des commandes slash...');
        const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
        
        await rest.put(
            Routes.applicationGuildCommands(DISCORD_CLIENT_APP_ID, GUILD_ID), 
            { body: commands }
        );
        
        console.log(`✅ ${commands.length} commandes slash enregistrées`);
        botStatus.commands = commands.map(c => c.name);
    } catch (error) {
        console.error('❌ Erreur enregistrement commandes:', error.message);
        if (error.code === 50001) {
            console.error('⚠️  Le bot n\'a pas accès au serveur. Vérifiez:');
            console.error('   1. Le bot est invité sur le serveur');
            console.error('   2. GUILD_ID est correct');
            console.error('   3. Le bot a les permissions applications.commands');
        }
    }
}

// ============================================================
// ===           EVENTS BOT                                 ===
// ============================================================
client.once('ready', async () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log(`║   ✅ BOT CONNECTÉ: ${client.user.tag.padEnd(36)} ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    
    botStatus.isReady = true;
    botStatus.guilds = client.guilds.cache.size;
    const allMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    botStatus.members = allMembers;

    console.log(`📊 Statistiques:`);
    console.log(`   • Serveurs: ${botStatus.guilds}`);
    console.log(`   • Membres: ${botStatus.members}`);
    console.log('');

    client.user.setPresence({
        status: 'online',
        activities: [{ name: 'FTY Club Pro | /site', type: ActivityType.Playing }]
    });

    loadServerConfig();
    await registerCommands();
    addBotLog('🚀 Bot FTY Club Pro démarré avec succès');

    // Test connexion panel
    try {
        await sendToPanel('status', { isReady: true });
        console.log('✅ Connexion au panel établie');
    } catch (e) {
        console.log('⚠️  Panel non accessible (normal si panel pas encore démarré)');
    }

    // Update stats every minute
    setInterval(() => {
        botStatus.guilds = client.guilds.cache.size;
        botStatus.members = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    }, 60000);
});

// ============================================================
// ===           INTERACTION HANDLER                        ===
// ============================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
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
                    { name: '🎮 Rejoindre', value: `[S'inscrire](${PANEL_URL}/candidature)`, inline: true }
                )
                .setFooter({ text: 'FTY Club Pro' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            addBotLog(`🌐 /site utilisé par ${user.tag}`);
        }

        else if (commandName === 'status') {
            if (!isXywez) {
                return interaction.reply({ 
                    content: '❌ Cette commande est réservée à Xywez uniquement.', 
                    ephemeral: true 
                });
            }
            
            const uptime = Date.now() - botStatus.uptime;
            const days = Math.floor(uptime / 86400000);
            const hours = Math.floor((uptime % 86400000) / 3600000);
            const minutes = Math.floor((uptime % 3600000) / 60000);
            
            // Test connexion panel
            let panelStatus = '🔴 Non connecté';
            try {
                await axios.get(`${PANEL_URL}/health`, { timeout: 3000 });
                panelStatus = '🟢 Connecté';
                botStatus.panelConnected = true;
            } catch (e) {
                botStatus.panelConnected = false;
            }
            
            const embed = new EmbedBuilder()
                .setColor(botStatus.panelConnected ? '#22c55e' : '#f59e0b')
                .setTitle('📊 Statistiques du Bot - FTY Club Pro')
                .setDescription('Informations détaillées sur le bot Discord')
                .addFields(
                    { name: '🤖 Statut Bot', value: botStatus.isReady ? '🟢 En ligne' : '🔴 Hors ligne', inline: true },
                    { name: '🌐 Connexion Panel', value: panelStatus, inline: true },
                    { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true },
                    { name: '🎮 Serveurs', value: `${botStatus.guilds}`, inline: true },
                    { name: '👥 Membres', value: `${botStatus.members}`, inline: true },
                    { name: '⏱️ Uptime', value: `${days}j ${hours}h ${minutes}m`, inline: true },
                    { name: '🔧 Maintenance', value: botStatus.maintenanceMode ? '🔧 Activée' : '✅ Désactivée', inline: true },
                    { name: '📝 Commandes', value: `${botStatus.commands.length} enregistrées`, inline: true },
                    { name: '📊 Logs', value: `${botStatus.logs.length} entrées`, inline: true }
                )
                .setFooter({ text: `FTY Club Pro • Demandé par ${user.tag}` })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
            addBotLog(`📊 /status utilisé par ${user.tag}`);
        }

    } catch (err) {
        console.error(`❌ Erreur commande ${commandName}:`, err.message);
        
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({ 
                    content: `❌ Une erreur est survenue: ${err.message}`, 
                    ephemeral: true 
                });
            } catch (e) {
                console.error('❌ Impossible de répondre à l\'interaction:', e.message);
            }
        }
    }
});

// Gestion des erreurs Discord
client.on('error', error => {
    console.error('❌ Erreur client Discord:', error.message);
    addBotLog('Erreur client: ' + error.message);
});

client.on('warn', info => {
    console.warn('⚠️  Warning Discord:', info);
});

// ============================================================
// ===           API EXPRESS POUR PANEL                     ===
// ============================================================
const app = express();
app.use(express.json());

function verifyApiKey(req, res, next) {
    const apiKey = req.body?.apiKey || req.headers['x-api-key'];
    if (apiKey !== PANEL_API_KEY) {
        console.log('⚠️  Tentative d\'accès API avec clé invalide');
        return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
}

app.get('/api/status', verifyApiKey, (req, res) => {
    res.json(botStatus);
});

app.post('/api/update-status', verifyApiKey, (req, res) => {
    const { status, activity, activityType } = req.body;
    if (!botStatus.isReady) {
        return res.status(503).json({ error: 'Bot not connected' });
    }
    const success = updateBotStatus(status, activity, parseInt(activityType));
    if (success) {
        res.json({ success: true, botStatus });
    } else {
        res.status(500).json({ error: 'Failed to update status' });
    }
});

app.post('/api/send-dm', verifyApiKey, async (req, res) => {
    const { discordId, embed } = req.body;
    if (!discordId || !embed) {
        return res.status(400).json({ error: 'Missing discordId or embed' });
    }
    try {
        const discordEmbed = new EmbedBuilder(embed);
        const success = await sendDiscordDM(discordId, discordEmbed);
        res.json({ success });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/bot', verifyApiKey, async (req, res) => {
    const { action, data } = req.body;
    try {
        if (action === 'maintenance') {
            botStatus.maintenanceMode = data?.enabled || false;
            addBotLog(`🔧 Maintenance ${data?.enabled ? 'activée' : 'désactivée'} depuis panel`);
        } else if (action === 'log') {
            if (data) {
                botStatus.logs.unshift(data);
                if (botStatus.logs.length > 500) botStatus.logs = botStatus.logs.slice(0, 500);
            }
        }
        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.post('/api/geoip', verifyApiKey, async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP manquante' });
    const geo = await getGeoIP(ip);
    res.json(geo);
});

app.get('/api/logs', verifyApiKey, (req, res) => {
    res.json({ logs: botStatus.logs });
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        bot: 'FTY Club Pro', 
        botReady: botStatus.isReady, 
        maintenance: botStatus.maintenanceMode,
        version: '3.0',
        guilds: botStatus.guilds,
        members: botStatus.members
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        botReady: botStatus.isReady, 
        uptime: Date.now() - botStatus.uptime,
        panelConnected: botStatus.panelConnected
    });
});

// ============================================================
// ===           DÉMARRAGE                                  ===
// ============================================================
app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                                                          ║');
    console.log('║        🤖  FTY CLUB PRO - BOT DISCORD V3.0  🤖          ║');
    console.log('║                                                          ║');
    console.log(`║   📡  API:    http://localhost:${PORT.toString().padEnd(27)} ║`);
    console.log(`║   🔗  Panel:  ${PANEL_URL.padEnd(40)} ║`);
    console.log('║                                                          ║');
    console.log(`║   👑  Owner: Xywez (${SUPER_ADMIN_DISCORD_ID})  ║`);
    console.log(`║   🆔  Guild: ${GUILD_ID}                             ║`);
    console.log('║                                                          ║');
    console.log('║   📋  Commandes disponibles:                             ║');
    console.log('║   • /site - Affiche le lien du site                     ║');
    console.log('║   • /status - Stats bot (Xywez uniquement)               ║');
    console.log('║                                                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
});

// Connexion Discord avec gestion d'erreur améliorée
if (DISCORD_BOT_TOKEN) {
    console.log('🔄 Connexion au bot Discord...');
    client.login(DISCORD_BOT_TOKEN).catch(err => {
        console.error('');
        console.error('╔═══════════════════════════════════════════════════════════╗');
        console.error('║  ❌ ERREUR DE CONNEXION DU BOT DISCORD                   ║');
        console.error('╚═══════════════════════════════════════════════════════════╝');
        console.error('');
        console.error('Erreur:', err.message);
        console.error('');
        console.error('⚠️  Vérifications possibles:');
        console.error('   1. Le token est valide et correct');
        console.error('   2. Le bot n\'est pas désactivé sur Discord');
        console.error('   3. Les intentions (intents) sont activées');
        console.error('   4. Connexion internet disponible');
        console.error('');
        addBotLog('Erreur de connexion: ' + err.message);
        process.exit(1);
    });
} else {
    console.error('❌ DISCORD_BOT_TOKEN non défini!');
    process.exit(1);
}

// Gestion des signaux de terminaison (pour Render)
process.on('SIGTERM', () => {
    console.log('📴 Signal SIGTERM reçu, arrêt gracieux...');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📴 Signal SIGINT reçu, arrêt gracieux...');
    client.destroy();
    process.exit(0);
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    console.error('❌ Erreur non capturée:', error);
    addBotLog('Erreur critique: ' + error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejetée non gérée:', reason);
    addBotLog('Promise rejetée: ' + reason);
});
