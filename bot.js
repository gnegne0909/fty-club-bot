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
const PANEL_URL = 'https://fty-club-pro-1.onrender.com'; // URL du panel
const PANEL_API_KEY = process.env.PANEL_API_KEY || 'fty-secret-api-key-2026'; // Clé pour communiquer avec le panel

// Port pour l'API du bot (pour que le panel puisse communiquer)
const PORT = process.env.PORT || 3001;

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
    commands: []
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
            {
                name: 'utilisateur',
                description: 'Membre à bannir',
                type: 6,
                required: true
            },
            {
                name: 'raison',
                description: 'Raison du bannissement',
                type: 3,
                required: false
            }
        ]
    },
    {
        name: 'kick',
        description: '👢 Expulser un membre',
        options: [
            {
                name: 'utilisateur',
                description: 'Membre à expulser',
                type: 6,
                required: true
            },
            {
                name: 'raison',
                description: 'Raison de l\'expulsion',
                type: 3,
                required: false
            }
        ]
    },
    {
        name: 'announce',
        description: '📢 Créer une annonce',
        options: [
            {
                name: 'type',
                description: 'Type d\'annonce',
                type: 3,
                required: true,
                choices: [
                    { name: 'Global', value: 'global' },
                    { name: 'Match', value: 'match' },
                    { name: 'Conférence', value: 'conference' },
                    { name: 'Recrutement', value: 'recrutement' }
                ]
            },
            {
                name: 'message',
                description: 'Contenu de l\'annonce',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'ticket',
        description: '🎫 Ouvrir un ticket de support',
        options: [
            {
                name: 'sujet',
                description: 'Sujet du ticket',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'status',
        description: '📊 Affiche les statistiques du bot',
    }
];

// ============================================================
// ===           FONCTIONS UTILITAIRES                      ===
// ============================================================
function addBotLog(message) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        message: message
    };
    
    botStatus.logs.unshift(logEntry);
    if (botStatus.logs.length > 200) {
        botStatus.logs = botStatus.logs.slice(0, 200);
    }
    
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
    
    // Envoyer au panel
    sendToPanel('log', logEntry).catch(() => {});
}

function updateBotStatus(status, activityName, activityType) {
    if (!client.user) return false;
    
    try {
        botStatus.status = status;
        botStatus.activity = { name: activityName, type: activityType };
        
        client.user.setPresence({
            status: status,
            activities: [{
                name: activityName,
                type: activityType
            }]
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
        fs.writeFileSync(
            path.join(__dirname, 'server-config.json'),
            JSON.stringify(serverConfig, null, 2)
        );
    } catch (error) {
        console.error('Erreur sauvegarde config:', error);
    }
}

function loadServerConfig() {
    try {
        const configFile = path.join(__dirname, 'server-config.json');
        if (fs.existsSync(configFile)) {
            serverConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            console.log('✅ Configuration serveur chargée');
        }
    } catch (error) {
        console.error('Erreur chargement config:', error);
    }
}

async function sendToPanel(action, data) {
    try {
        await axios.post(`${PANEL_URL}/api/bot`, {
            apiKey: PANEL_API_KEY,
            action: action,
            data: data
        }, {
            timeout: 5000
        });
    } catch (error) {
        // Silence les erreurs pour ne pas spammer les logs
    }
}

async function sendDiscordDM(discordId, embed) {
    try {
        const user = await client.users.fetch(discordId);
        await user.send({ embeds: [embed] });
        return true;
    } catch (error) {
        console.error('Erreur envoi DM:', error);
        return false;
    }
}

// ============================================================
// ===           ENREGISTREMENT COMMANDES                   ===
// ============================================================
async function registerCommands() {
    if (!DISCORD_BOT_TOKEN) {
        console.error('❌ DISCORD_BOT_TOKEN manquant');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
    const appId = client.user.id;

    // Étape 1 : Purger toutes les commandes globales (elles masquent les guild commands)
    try {
        console.log('🧹 Suppression des commandes globales...');
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        console.log('✅ Commandes globales supprimées');
    } catch (err) {
        console.warn('⚠️ Impossible de supprimer les commandes globales:', err.message);
    }

    // Petit délai pour que Discord propage la suppression
    await new Promise(r => setTimeout(r, 1500));

    // Étape 2 : Enregistrer les nouvelles commandes sur le serveur
    try {
        console.log('🔄 Enregistrement de ' + commands.length + ' commandes sur le serveur ' + GUILD_ID + '...');
        const result = await rest.put(
            Routes.applicationGuildCommands(appId, GUILD_ID),
            { body: commands }
        );
        console.log('✅ ' + result.length + ' commandes enregistrées: ' + commands.map(c => '/' + c.name).join(', '));
        botStatus.commands = commands.map(c => c.name);
        addBotLog('✅ ' + result.length + ' commandes enregistrées: ' + botStatus.commands.join(', '));
    } catch (error) {
        console.error('❌ Erreur enregistrement commandes:', error.message);
        if (error.status === 403) {
            console.error('💡 SOLUTION: Réinvite le bot avec le scope applications.commands');
            console.error('🔗 https://discord.com/api/oauth2/authorize?client_id=' + appId + '&permissions=8&scope=bot%20applications.commands');
        }
        addBotLog('❌ Erreur enregistrement commandes: ' + error.message);
    }
}

// ============================================================
// ===           ÉVÉNEMENTS BOT                             ===
// ============================================================
client.on('ready', async () => {
    console.log(`✅ Bot connecté: ${client.user.tag}`);
    botStatus.isReady = true;
    botStatus.guilds = client.guilds.cache.size;
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        botStatus.members = guild.memberCount;
    }
    
    updateBotStatus('online', 'FTY Club Pro | /site', ActivityType.Playing);
    addBotLog('Bot démarré avec succès - ' + client.user.tag);
    
    await registerCommands();
    loadServerConfig();
    
    // Notifier le panel que le bot est en ligne
    sendToPanel('status', botStatus);
});

client.on('error', (error) => {
    console.error('Erreur bot:', error);
    addBotLog('Erreur: ' + error.message);
});

// ============================================================
// ===           ANTI-RAID & ANTI-DOUBLE COMPTE             ===
// ============================================================
const joinTracker = new Map();

client.on('guildMemberAdd', async (member) => {
    const now = Date.now();
    
    // Anti-double compte (vérifie la date de création)
    const accountAge = now - member.user.createdTimestamp;
    const minAge = 7 * 24 * 60 * 60 * 1000; // 7 jours
    
    if (accountAge < minAge) {
        try {
            await member.send(`❌ Votre compte Discord est trop récent pour rejoindre ${member.guild.name}. Revenez dans ${Math.ceil((minAge - accountAge) / (24 * 60 * 60 * 1000))} jours.`);
        } catch {}
        
        await member.kick('Compte Discord trop récent (anti-double compte)');
        addBotLog(`Anti-double compte: ${member.user.tag} expulsé (compte créé il y a ${Math.floor(accountAge / (24 * 60 * 60 * 1000))} jours)`);
        
        // Notifier le panel
        sendToPanel('antiDoubleCompte', {
            user: member.user.tag,
            userId: member.user.id,
            accountAge: Math.floor(accountAge / (24 * 60 * 60 * 1000))
        });
        
        return;
    }
    
    // Anti-raid
    const key = 'joins';
    const joins = joinTracker.get(key) || [];
    joins.push(now);
    
    const recentJoins = joins.filter(t => now - t < 10000);
    joinTracker.set(key, recentJoins);
    
    if (recentJoins.length >= 5) {
        addBotLog(`🚨 ANTI-RAID ACTIVÉ: ${recentJoins.length} arrivées en 10s`);
        
        const owner = await client.users.fetch(SUPER_ADMIN_DISCORD_ID);
        if (owner) {
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🚨 ALERTE ANTI-RAID')
                .setDescription(`**${recentJoins.length}** membres ont rejoint en moins de 10 secondes!`)
                .addFields(
                    { name: 'Serveur', value: member.guild.name, inline: true },
                    { name: 'Dernier membre', value: member.user.tag, inline: true }
                )
                .setTimestamp();
            
            try {
                await owner.send({ embeds: [embed] });
            } catch {}
        }
        
        // Notifier le panel
        sendToPanel('antiRaid', {
            count: recentJoins.length,
            lastUser: member.user.tag
        });
    }
    
    // Assigner le rôle règlement s'il existe
    if (serverConfig.roles?.reglementRole) {
        try {
            const role = member.guild.roles.cache.get(serverConfig.roles.reglementRole);
            if (role) {
                await member.roles.add(role);
            }
        } catch (error) {
            console.error('Erreur attribution rôle règlement:', error);
        }
    }
});

// ============================================================
// ===           ANTI-LINK                                  ===
// ============================================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const linkRegex = /(https?:\/\/[^\s]+)|(discord\.gg\/[^\s]+)/gi;
    const hasLink = linkRegex.test(message.content);
    
    if (hasLink) {
        const member = message.member;
        const allowedRoles = ['owner', 'fondateur', 'cofondateur', 'manager', 'administrateur', 'moderateur'];
        
        const hasPermission = member.roles.cache.some(role => 
            allowedRoles.some(allowed => role.name.toLowerCase().includes(allowed))
        );
        
        if (!hasPermission) {
            try {
                await message.delete();
                const warning = await message.channel.send(`❌ ${message.author}, les liens ne sont pas autorisés ici!`);
                setTimeout(() => warning.delete().catch(() => {}), 5000);
                
                addBotLog(`Anti-link: Message de ${message.author.tag} supprimé`);
                
                sendToPanel('antiLink', {
                    user: message.author.tag,
                    userId: message.author.id,
                    channel: message.channel.name,
                    content: message.content
                });
            } catch (error) {
                console.error('Erreur anti-link:', error);
            }
        }
    }
});

// ============================================================
// ===           GESTION COMMANDES SLASH                    ===
// ============================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;
    
    // Bouton acceptation règlement
    if (interaction.isButton() && interaction.customId === 'accept_rules') {
        try {
            const member = interaction.member;
            const reglementRoleId = serverConfig.roles?.reglementRole;
            
            if (reglementRoleId) {
                const reglementRole = member.guild.roles.cache.get(reglementRoleId);
                if (reglementRole && member.roles.cache.has(reglementRoleId)) {
                    await member.roles.remove(reglementRole);
                    
                    await interaction.reply({
                        content: '✅ Règlement accepté! Vous avez maintenant accès à l\'ensemble du serveur. Bienvenue! 🎉',
                        ephemeral: true
                    });
                    
                    addBotLog(`${member.user.tag} a accepté le règlement`);
                    
                    sendToPanel('rulesAccepted', {
                        user: member.user.tag,
                        userId: member.user.id
                    });
                } else {
                    await interaction.reply({
                        content: '✅ Vous avez déjà accepté le règlement!',
                        ephemeral: true
                    });
                }
            }
        } catch (error) {
            console.error('Erreur acceptation règlement:', error);
            await interaction.reply({
                content: '❌ Une erreur est survenue.',
                ephemeral: true
            });
        }
        return;
    }
    
    if (!interaction.isCommand()) return;
    
    const { commandName, user } = interaction;
    
    addBotLog(`Commande /${commandName} par ${user.tag}`);
    
    try {
        switch (commandName) {
            case 'setup':
                await handleSetup(interaction);
                break;
            case 'nuke':
                await handleNuke(interaction);
                break;
            case 'site':
                await handleSite(interaction);
                break;
            case 'ban':
                await handleBan(interaction);
                break;
            case 'kick':
                await handleKick(interaction);
                break;
            case 'announce':
                await handleAnnounce(interaction);
                break;
            case 'ticket':
                await handleTicket(interaction);
                break;
            case 'status':
                await handleStatus(interaction);
                break;
        }
    } catch (error) {
        console.error(`Erreur commande ${commandName}:`, error);
        addBotLog(`Erreur ${commandName}: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Erreur')
            .setDescription(`Une erreur est survenue lors de l'exécution de la commande.`)
            .setFooter({ text: 'FTY Club Pro' });
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// ============================================================
// ===           COMMANDE /SETUP                            ===
// ============================================================
async function handleSetup(interaction) {
    // Vérifier les permissions (Owner uniquement)
    if (interaction.user.id !== SUPER_ADMIN_DISCORD_ID) {
        // Vérifier avec le panel si l'utilisateur est owner
        try {
            const response = await axios.post(`${PANEL_URL}/api/bot/check-permission`, {
                apiKey: PANEL_API_KEY,
                discordId: interaction.user.id,
                requiredRole: 'owner'
            }, { timeout: 5000 });
            
            if (!response.data.hasPermission) {
                return interaction.reply({ 
                    content: '❌ Cette commande est réservée aux owners!', 
                    ephemeral: true 
                });
            }
        } catch {
            return interaction.reply({ 
                content: '❌ Impossible de vérifier vos permissions. Cette commande est réservée aux owners!', 
                ephemeral: true 
            });
        }
    }
    
    await interaction.deferReply();
    
    const guild = interaction.guild;
    const setupConfig = {
        categories: {},
        channels: {},
        roles: {}
    };
    
    try {
        // ===== CRÉATION DES RÔLES =====
        const rolesToCreate = [
            { name: '👑 Owner', color: '#9333ea', position: 10 },
            { name: '🌟 Fondateur', color: '#7c3aed', position: 9 },
            { name: '⭐ Co-Fondateur', color: '#8b5cf6', position: 8 },
            { name: '📊 Manager', color: '#a855f7', position: 7 },
            { name: '🛡️ Administrateur', color: '#c084fc', position: 6 },
            { name: '⚖️ Modérateur', color: '#d946ef', position: 5 },
            { name: '🎧 Support', color: '#ec4899', position: 4 },
            { name: '🎯 Capitaine', color: '#f472b6', position: 3 },
            { name: '⚽ Joueur Confirmé', color: '#fbbf24', position: 2 },
            { name: '📝 Règlement à Accepter', color: '#6b7280', position: 1 },
            // Plateformes
            { name: '🖥️ PC', color: '#3b82f6', position: 0 },
            { name: '🎮 PlayStation', color: '#0ea5e9', position: 0 },
            { name: '🟢 Xbox', color: '#22c55e', position: 0 },
            { name: '🔴 Nintendo Switch', color: '#ef4444', position: 0 },
            { name: '📱 Mobile', color: '#8b5cf6', position: 0 }
        ];
        
        for (const roleData of rolesToCreate) {
            let role = guild.roles.cache.find(r => r.name === roleData.name);
            if (!role) {
                role = await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    position: roleData.position,
                    reason: 'Configuration automatique /setup'
                });
            }
            
            const key = roleData.name.toLowerCase().replace(/[^a-z]/g, '');
            setupConfig.roles[key] = role.id;
            
            if (roleData.name.includes('Règlement')) {
                setupConfig.roles.reglementRole = role.id;
            }
        }
        
        // ===== CATÉGORIE RÈGLEMENT =====
        const catReglement = await guild.channels.create({
            name: '📜 RÈGLEMENT',
            type: ChannelType.GuildCategory,
            reason: 'Configuration automatique /setup'
        });
        setupConfig.categories.reglement = catReglement.id;
        
        const chanReglement = await guild.channels.create({
            name: '📜│règlement',
            type: ChannelType.GuildText,
            parent: catReglement.id,
            reason: 'Configuration automatique /setup',
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel]
                },
                {
                    id: setupConfig.roles.reglementRole,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages]
                }
            ]
        });
        setupConfig.channels.reglement = chanReglement.id;
        
        // Message règlement
        const reglementEmbed = new EmbedBuilder()
            .setColor('#9333ea')
            .setTitle('📜 RÈGLEMENT DU SERVEUR FTY CLUB PRO')
            .setDescription(`**Bienvenue sur le serveur officiel de FTY Club Pro!**\n\n` +
                `**1️⃣ Respect**\n` +
                `• Respectez tous les membres du serveur\n` +
                `• Pas d'insultes, de harcèlement ou de discrimination\n\n` +
                `**2️⃣ Communication**\n` +
                `• Restez dans le sujet des salons\n` +
                `• Pas de spam ou de flood\n` +
                `• Pas de publicité sans autorisation\n\n` +
                `**3️⃣ Contenu**\n` +
                `• Pas de contenu NSFW\n` +
                `• Pas de liens suspects ou malveillants\n` +
                `• Respectez les droits d'auteur\n\n` +
                `**4️⃣ Jeu**\n` +
                `• Fair-play obligatoire\n` +
                `• Pas de triche ou d'abus de bugs\n` +
                `• Respectez les décisions des capitaines\n\n` +
                `**5️⃣ Sanctions**\n` +
                `• Avertissement → Mute → Kick → Ban\n` +
                `• Les sanctions sont à la discrétion du staff\n\n` +
                `✅ **En cochant ci-dessous, vous acceptez le règlement et accédez au serveur.**`
            )
            .setFooter({ text: 'FTY Club Pro • Règlement v1.0' })
            .setTimestamp();
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('accept_rules')
                    .setLabel('✅ J\'accepte le règlement')
                    .setStyle(ButtonStyle.Success)
            );
        
        await chanReglement.send({ embeds: [reglementEmbed], components: [buttonRow] });
        
        // ===== CATÉGORIE INFORMATIONS =====
        const catInfo = await guild.channels.create({
            name: '📢 INFORMATIONS',
            type: ChannelType.GuildCategory,
            reason: 'Configuration automatique /setup'
        });
        setupConfig.categories.informations = catInfo.id;
        
        const infoChannels = [
            { name: '📢│annonces-globales', topic: 'Annonces importantes du club' },
            { name: '⚽│annonces-matchs', topic: 'Annonces des matchs à venir' },
            { name: '🎤│conférences', topic: 'Conférences et réunions' },
            { name: '🎯│recrutement', topic: 'Annonces de recrutement' }
        ];
        
        for (const chan of infoChannels) {
            const channel = await guild.channels.create({
                name: chan.name,
                type: ChannelType.GuildText,
                parent: catInfo.id,
                topic: chan.topic,
                reason: 'Configuration automatique /setup',
                permissionOverwrites: [
                    {
                        id: guild.id,
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: setupConfig.roles.owner,
                        allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
                    }
                ]
            });
            
            const key = chan.name.split('│')[1];
            setupConfig.channels[key] = channel.id;
        }
        
        // ===== CATÉGORIE GÉNÉRAL =====
        const catGeneral = await guild.channels.create({
            name: '💬 GÉNÉRAL',
            type: ChannelType.GuildCategory,
            reason: 'Configuration automatique /setup'
        });
        setupConfig.categories.general = catGeneral.id;
        
        const generalChannels = [
            { name: '💬│discussion-générale', type: ChannelType.GuildText },
            { name: '🎮│gaming', type: ChannelType.GuildText },
            { name: '🔊│Vocal Général', type: ChannelType.GuildVoice }
        ];
        
        for (const chan of generalChannels) {
            await guild.channels.create({
                name: chan.name,
                type: chan.type,
                parent: catGeneral.id,
                reason: 'Configuration automatique /setup'
            });
        }
        
        // ===== CATÉGORIE JOUEURS CONFIRMÉS =====
        const catJoueurs = await guild.channels.create({
            name: '⚽ JOUEURS CONFIRMÉS',
            type: ChannelType.GuildCategory,
            reason: 'Configuration automatique /setup',
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: setupConfig.roles.joueurconfirm || setupConfig.roles.owner,
                    allow: [PermissionFlagsBits.ViewChannel]
                }
            ]
        });
        setupConfig.categories.joueurs = catJoueurs.id;
        
        await guild.channels.create({
            name: '⚽│équipe',
            type: ChannelType.GuildText,
            parent: catJoueurs.id,
            reason: 'Configuration automatique /setup'
        });
        
        await guild.channels.create({
            name: '🔊│Vocal Équipe',
            type: ChannelType.GuildVoice,
            parent: catJoueurs.id,
            reason: 'Configuration automatique /setup'
        });
        
        // ===== CATÉGORIE STAFF =====
        const catStaff = await guild.channels.create({
            name: '🛡️ STAFF',
            type: ChannelType.GuildCategory,
            reason: 'Configuration automatique /setup',
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: setupConfig.roles.support || setupConfig.roles.owner,
                    allow: [PermissionFlagsBits.ViewChannel]
                }
            ]
        });
        setupConfig.categories.staff = catStaff.id;
        
        const staffChannels = [
            { name: '🛡️│staff-général', type: ChannelType.GuildText },
            { name: '🎫│tickets', type: ChannelType.GuildText },
            { name: '📊│logs', type: ChannelType.GuildText },
            { name: '🔊│Vocal Staff', type: ChannelType.GuildVoice }
        ];
        
        for (const chan of staffChannels) {
            const channel = await guild.channels.create({
                name: chan.name,
                type: chan.type,
                parent: catStaff.id,
                reason: 'Configuration automatique /setup'
            });
            
            if (chan.name.includes('tickets')) {
                setupConfig.channels.tickets = channel.id;
            }
            if (chan.name.includes('logs')) {
                setupConfig.channels.logs = channel.id;
            }
        }
        
        // Sauvegarder la configuration
        serverConfig = {
            configured: true,
            ...setupConfig
        };
        saveServerConfig();
        
        // Notifier le panel
        sendToPanel('setupComplete', setupConfig);
        
        // Réponse de succès
        const successEmbed = new EmbedBuilder()
            .setColor('#22c55e')
            .setTitle('✅ Configuration Terminée!')
            .setDescription(
                `Le serveur **${guild.name}** a été configuré avec succès!\n\n` +
                `**Créé:**\n` +
                `✅ ${rolesToCreate.length} rôles\n` +
                `✅ 6 catégories\n` +
                `✅ 15+ salons\n` +
                `✅ Système de règlement avec bouton\n` +
                `✅ Anti-raid et anti-link activés\n` +
                `✅ Système de tickets DM\n\n` +
                `Le serveur est maintenant prêt à l'emploi!`
            )
            .setFooter({ text: 'FTY Club Pro • Setup v1.0' })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed] });
        addBotLog(`Setup terminé par ${interaction.user.tag} sur ${guild.name}`);
        
    } catch (error) {
        console.error('Erreur setup:', error);
        await interaction.editReply({
            content: `❌ Erreur lors du setup: ${error.message}`
        });
    }
}

// ============================================================
// ===           COMMANDE /NUKE                             ===
// ============================================================
async function handleNuke(interaction) {
    if (interaction.user.id !== SUPER_ADMIN_DISCORD_ID) {
        return interaction.reply({ 
            content: '❌ Cette commande est réservée à Xywez uniquement!', 
            ephemeral: true 
        });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: 100 });
        
        await channel.bulkDelete(messages, true);
        
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('💣 SALON NUKE')
            .setDescription(`Ce salon a été nettoyé par ${interaction.user.tag}`)
            .setTimestamp();
        
        await channel.send({ embeds: [embed] });
        
        await interaction.editReply({ content: `✅ ${messages.size} messages supprimés!` });
        addBotLog(`NUKE: ${messages.size} messages supprimés dans #${channel.name} par ${interaction.user.tag}`);
        
        sendToPanel('nuke', {
            user: interaction.user.tag,
            channel: channel.name,
            count: messages.size
        });
        
    } catch (error) {
        await interaction.editReply({ content: `❌ Erreur: ${error.message}` });
    }
}

// ============================================================
// ===           COMMANDE /SITE                             ===
// ============================================================
async function handleSite(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#9333ea')
        .setTitle('🌐 Site Web FTY Club Pro')
        .setDescription(
            `**Accédez à notre site officiel:**\n\n` +
            `🔗 [${PANEL_URL}](${PANEL_URL})\n\n` +
            `**Fonctionnalités:**\n` +
            `✅ Connexion avec Discord\n` +
            `✅ Panel d'administration complet\n` +
            `✅ Système de candidatures\n` +
            `✅ Gestion des matchs et annonces\n` +
            `✅ Statistiques en temps réel\n\n` +
            `👑 **Pour les membres du staff:** Connectez-vous pour accéder à votre panel!`
        )
        .setThumbnail(interaction.guild?.iconURL())
        .setFooter({ text: 'FTY Club Pro' })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

// ============================================================
// ===           COMMANDE /BAN                              ===
// ============================================================
async function handleBan(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ 
            content: '❌ Vous n\'avez pas la permission de bannir des membres!', 
            ephemeral: true 
        });
    }
    
    const targetUser = interaction.options.getUser('utilisateur');
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
    
    try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        
        if (!member.bannable) {
            return interaction.reply({ 
                content: '❌ Je ne peux pas bannir ce membre (rôle supérieur ou permissions insuffisantes)!', 
                ephemeral: true 
            });
        }
        
        // DM avant ban
        const dmEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('🔨 Vous avez été banni')
            .setDescription(`Vous avez été banni de **${interaction.guild.name}**`)
            .addFields(
                { name: 'Raison', value: reason },
                { name: 'Modérateur', value: interaction.user.tag }
            )
            .setTimestamp();
        
        try {
            await targetUser.send({ embeds: [dmEmbed] });
        } catch {}
        
        await member.ban({ reason: `${reason} | Par ${interaction.user.tag}` });
        
        // Notifier le panel
        sendToPanel('ban', {
            targetUser: targetUser.tag,
            targetUserId: targetUser.id,
            moderator: interaction.user.tag,
            moderatorId: interaction.user.id,
            reason: reason
        });
        
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('🔨 Membre Banni')
            .addFields(
                { name: 'Utilisateur', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Modérateur', value: interaction.user.tag, inline: true },
                { name: 'Raison', value: reason }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        if (serverConfig.channels?.logs) {
            const logChannel = interaction.guild.channels.cache.get(serverConfig.channels.logs);
            if (logChannel) {
                await logChannel.send({ embeds: [embed] });
            }
        }
        
        addBotLog(`BAN: ${targetUser.tag} banni par ${interaction.user.tag} - Raison: ${reason}`);
        
    } catch (error) {
        await interaction.reply({ 
            content: `❌ Erreur lors du bannissement: ${error.message}`, 
            ephemeral: true 
        });
    }
}

// ============================================================
// ===           COMMANDE /KICK                             ===
// ============================================================
async function handleKick(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return interaction.reply({ 
            content: '❌ Vous n\'avez pas la permission d\'expulser des membres!', 
            ephemeral: true 
        });
    }
    
    const targetUser = interaction.options.getUser('utilisateur');
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
    
    try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        
        if (!member.kickable) {
            return interaction.reply({ 
                content: '❌ Je ne peux pas expulser ce membre!', 
                ephemeral: true 
            });
        }
        
        const dmEmbed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('👢 Vous avez été expulsé')
            .setDescription(`Vous avez été expulsé de **${interaction.guild.name}**`)
            .addFields(
                { name: 'Raison', value: reason },
                { name: 'Modérateur', value: interaction.user.tag }
            )
            .setTimestamp();
        
        try {
            await targetUser.send({ embeds: [dmEmbed] });
        } catch {}
        
        await member.kick(`${reason} | Par ${interaction.user.tag}`);
        
        sendToPanel('kick', {
            targetUser: targetUser.tag,
            targetUserId: targetUser.id,
            moderator: interaction.user.tag,
            moderatorId: interaction.user.id,
            reason: reason
        });
        
        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('👢 Membre Expulsé')
            .addFields(
                { name: 'Utilisateur', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Modérateur', value: interaction.user.tag, inline: true },
                { name: 'Raison', value: reason }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        if (serverConfig.channels?.logs) {
            const logChannel = interaction.guild.channels.cache.get(serverConfig.channels.logs);
            if (logChannel) {
                await logChannel.send({ embeds: [embed] });
            }
        }
        
        addBotLog(`KICK: ${targetUser.tag} expulsé par ${interaction.user.tag} - Raison: ${reason}`);
        
    } catch (error) {
        await interaction.reply({ 
            content: `❌ Erreur lors de l'expulsion: ${error.message}`, 
            ephemeral: true 
        });
    }
}

// ============================================================
// ===           COMMANDE /ANNOUNCE                         ===
// ============================================================
async function handleAnnounce(interaction) {
    // Vérifier permissions avec le panel
    try {
        const response = await axios.post(`${PANEL_URL}/api/bot/check-permission`, {
            apiKey: PANEL_API_KEY,
            discordId: interaction.user.id,
            requiredRole: 'moderateur'
        }, { timeout: 5000 });
        
        if (!response.data.hasPermission) {
            return interaction.reply({ 
                content: '❌ Vous devez être au moins modérateur pour créer des annonces!', 
                ephemeral: true 
            });
        }
    } catch {
        return interaction.reply({ 
            content: '❌ Impossible de vérifier vos permissions!', 
            ephemeral: true 
        });
    }
    
    const type = interaction.options.getString('type');
    const message = interaction.options.getString('message');
    
    const typeConfig = {
        global: { emoji: '📢', color: '#3b82f6', channel: 'annonces-globales' },
        match: { emoji: '⚽', color: '#22c55e', channel: 'annonces-matchs' },
        conference: { emoji: '🎤', color: '#a855f7', channel: 'conférences' },
        recrutement: { emoji: '🎯', color: '#f59e0b', channel: 'recrutement' }
    };
    
    const config = typeConfig[type];
    const channelId = serverConfig.channels?.[config.channel];
    
    if (!channelId) {
        return interaction.reply({ 
            content: '❌ Le salon d\'annonces n\'a pas été configuré! Utilisez /setup', 
            ephemeral: true 
        });
    }
    
    try {
        const channel = interaction.guild.channels.cache.get(channelId);
        
        const embed = new EmbedBuilder()
            .setColor(config.color)
            .setTitle(`${config.emoji} Annonce ${type.toUpperCase()}`)
            .setDescription(message)
            .setAuthor({ 
                name: interaction.user.tag, 
                iconURL: interaction.user.displayAvatarURL() 
            })
            .setFooter({ text: 'FTY Club Pro' })
            .setTimestamp();
        
        const sentMessage = await channel.send({ 
            content: '@everyone',
            embeds: [embed] 
        });
        
        // Notifier le panel
        sendToPanel('announce', {
            type: type,
            message: message,
            author: interaction.user.tag,
            authorId: interaction.user.id,
            channelId: channelId,
            messageId: sentMessage.id
        });
        
        await interaction.reply({ 
            content: `✅ Annonce publiée dans <#${channelId}>!`, 
            ephemeral: true 
        });
        
        addBotLog(`Annonce ${type} créée par ${interaction.user.tag}`);
        
    } catch (error) {
        await interaction.reply({ 
            content: `❌ Erreur: ${error.message}`, 
            ephemeral: true 
        });
    }
}

// ============================================================
// ===           COMMANDE /TICKET                           ===
// ============================================================
async function handleTicket(interaction) {
    const sujet = interaction.options.getString('sujet');
    
    try {
        const dmEmbed = new EmbedBuilder()
            .setColor('#3b82f6')
            .setTitle('🎫 Ticket Créé')
            .setDescription(
                `Votre ticket a été créé avec succès!\n\n` +
                `**Sujet:** ${sujet}\n\n` +
                `Un membre du support va vous contacter prochainement.\n` +
                `Vous pouvez répondre ici pour communiquer avec le support.`
            )
            .setFooter({ text: 'FTY Club Pro Support' })
            .setTimestamp();
        
        await interaction.user.send({ embeds: [dmEmbed] });
        
        if (serverConfig.channels?.tickets) {
            const ticketChannel = interaction.guild.channels.cache.get(serverConfig.channels.tickets);
            if (ticketChannel) {
                const staffEmbed = new EmbedBuilder()
                    .setColor('#f59e0b')
                    .setTitle('🎫 Nouveau Ticket')
                    .addFields(
                        { name: 'Utilisateur', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: 'Sujet', value: sujet, inline: true }
                    )
                    .setFooter({ text: 'Répondez en DM à l\'utilisateur' })
                    .setTimestamp();
                
                await ticketChannel.send({ embeds: [staffEmbed] });
            }
        }
        
        // Notifier le panel
        sendToPanel('ticket', {
            userId: interaction.user.id,
            username: interaction.user.tag,
            sujet: sujet
        });
        
        await interaction.reply({ 
            content: '✅ Votre ticket a été créé! Consultez vos messages privés.', 
            ephemeral: true 
        });
        
        addBotLog(`Ticket créé par ${interaction.user.tag}: ${sujet}`);
        
    } catch (error) {
        await interaction.reply({ 
            content: '❌ Impossible de créer le ticket. Assurez-vous que vos DM sont ouverts!', 
            ephemeral: true 
        });
    }
}

// ============================================================
// ===           COMMANDE /STATUS                           ===
// ============================================================
async function handleStatus(interaction) {
    const uptime = Date.now() - botStatus.uptime;
    const days = Math.floor(uptime / (24 * 60 * 60 * 1000));
    const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((uptime % (60 * 60 * 1000)) / (60 * 1000));
    
    const embed = new EmbedBuilder()
        .setColor('#22c55e')
        .setTitle('📊 Statistiques du Bot')
        .addFields(
            { name: 'Statut', value: botStatus.isReady ? '🟢 En ligne' : '🔴 Hors ligne', inline: true },
            { name: 'Serveurs', value: `${botStatus.guilds}`, inline: true },
            { name: 'Membres', value: `${botStatus.members}`, inline: true },
            { name: 'Uptime', value: `${days}j ${hours}h ${minutes}m`, inline: true },
            { name: 'Commandes', value: `${botStatus.commands.length}`, inline: true },
            { name: 'Ping', value: `${client.ws.ping}ms`, inline: true }
        )
        .setFooter({ text: 'FTY Club Pro Bot' })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

// ============================================================
// ===           API EXPRESS POUR PANEL                     ===
// ============================================================
const app = express();
app.use(express.json());

// Middleware de vérification API key
function verifyApiKey(req, res, next) {
    const apiKey = req.body.apiKey || req.headers['x-api-key'];
    if (apiKey !== PANEL_API_KEY) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
}

// Endpoint pour le panel pour récupérer le statut du bot
app.get('/api/status', verifyApiKey, (req, res) => {
    res.json(botStatus);
});

// Endpoint pour le panel pour changer le statut du bot
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

// Endpoint pour envoyer des DM depuis le panel
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

// Endpoint pour vérifier les permissions
app.post('/api/check-permission', verifyApiKey, async (req, res) => {
    const { discordId, requiredRole } = req.body;
    
    // Cette vérification sera faite par le panel
    // Le bot ne connaît pas les rôles du panel
    res.json({ hasPermission: false, message: 'Use panel API instead' });
});

// Endpoint pour récupérer les logs
app.get('/api/logs', verifyApiKey, (req, res) => {
    res.json({ logs: botStatus.logs });
});

// Endpoint pour exécuter des commandes depuis le panel
app.post('/api/execute-command', verifyApiKey, async (req, res) => {
    const { command, guildId, channelId, userId } = req.body;
    
    // Seulement pour Xywez
    if (userId !== SUPER_ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    try {
        const guild = client.guilds.cache.get(guildId || GUILD_ID);
        if (!guild) {
            return res.status(404).json({ error: 'Guild not found' });
        }
        
        // Exécuter la commande (exemple basique)
        addBotLog(`Commande exécutée depuis le panel par ${userId}: ${command}`);
        
        res.json({ success: true, message: 'Command executed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        botReady: botStatus.isReady,
        uptime: Date.now() - botStatus.uptime
    });
});

// ============================================================
// ===           DÉMARRAGE                                  ===
// ============================================================
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        🤖  FTY CLUB PRO - BOT DISCORD  🤖              ║
║                                                          ║
║   📡  API:    http://localhost:${PORT}                      ║
║   🔗  Panel:  ${PANEL_URL}                               
║                                                          ║
║   👑  Owner: Xywez                                       ║
║   🆔  Guild ID: ${GUILD_ID}                             
║                                                          ║
║   ⚡  Fonctionnalités:                                   ║
║   • Commandes Slash (/setup, /nuke, etc.)                ║
║   • Anti-raid & Anti-double compte                       ║
║   • Anti-link                                            ║
║   • Système de tickets DM                                ║
║   • Communication avec le panel                          ║
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
    console.log('⚠️  Veuillez définir la variable d\'environnement DISCORD_BOT_TOKEN');
}
