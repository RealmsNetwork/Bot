// honeypot.js







const { EmbedBuilder, PermissionsBitField } = require('discord.js');



const fs = require('fs');



const path = require('path');







const DATA_FILE = path.join(__dirname, 'data.json');



const INTERNAL_MARKER = 'HONEYPOT_SECURITY_WARNING';







let clientRef = null;



let configRef = null;







let DATA = {



  warningMessageId: null,



  warningChannelId: null,



  lastConfigHash: null,



  processing: []



};







function loadData() {



  try {



    if (!fs.existsSync(DATA_FILE)) return;







    const data = JSON.parse(



      fs.readFileSync(DATA_FILE, 'utf8')



    );







    DATA = {



      ...DATA,



      ...data,



      processing: Array.isArray(data.processing)



        ? data.processing



        : []



    };



  } catch (e) {



    console.error('[Honeypot] Failed loading data:', e.message);



  }



}







function saveData() {



  try {



    fs.writeFileSync(



      DATA_FILE,



      JSON.stringify({



        warningMessageId: DATA.warningMessageId,



        warningChannelId: DATA.warningChannelId,



        lastConfigHash: DATA.lastConfigHash,



        processing: DATA.processing



      }, null, 2)



    );



  } catch (e) {



    console.error('[Honeypot] Failed saving data:', e.message);



  }



}







function getBranding() {



  return configRef?.branding || {};



}







function getServerName() {



  return getBranding().serverName || 'Server';



}







function getSupportUrl() {



  return getBranding().supportUrl || 'https://discord.gg/support';



}







function getWarningConfig() {



  return configRef?.honeypot?.warningEmbed || {};



}







function getEmoji() {



  return getWarningConfig().emoji || '';



}







function replace(text = '') {



  return text



    .replaceAll('{serverName}', getServerName())



    .replaceAll('{supportUrl}', getSupportUrl());



}







function getActionText(action) {



  switch (action) {



    case 'ban':



      return 'banned';



    case 'kick':



      return 'kicked';



    case 'timeout':



      return 'timed out';



    default:



      return action;



  }



}







function getHash() {



  const cfg = getWarningConfig();







  const str = JSON.stringify({



    title: cfg.title,



    description: cfg.description,



    color: cfg.color,



    emoji: cfg.emoji,



    footer: cfg.footer



  });







  let hash = 0;







  for (let i = 0; i < str.length; i++) {



    hash = ((hash << 5) - hash) + str.charCodeAt(i);



    hash |= 0;



  }







  return String(hash);



}







async function getChannel(id) {



  try {



    return await clientRef.channels.fetch(id);



  } catch {



    return null;



  }



}







async function getMember(guild, id) {



  try {



    return await guild.members.fetch(id);



  } catch {



    return null;



  }



}







function truncate(text, max = 1000) {



  if (!text) return 'None';







  return text.length > max



    ? text.slice(0, max) + '...'



    : text;



}







function isWarningMessage(message) {



  return !!message?.embeds?.[0]?.footer?.text?.includes(



    INTERNAL_MARKER



  );



}







function canPunish(member) {



  if (!member) return false;







  if (member.id === member.guild.ownerId)



    return false;







  if (member.id === clientRef.user.id)



    return false;







  const staffRole = configRef?.staff?.roleId;







  if (



    configRef.honeypot.ignoreStaff !== false &&



    staffRole &&



    member.roles.cache.has(staffRole)



  ) {



    return false;



  }







  const bot = member.guild.members.me;







  if (!bot)



    return false;







  return (



    bot.roles.highest.comparePositionTo(



      member.roles.highest



    ) > 0



  );



}







function hasPermission(channel, permission) {



  return !!channel.guild.members.me?.permissions.has(



    permission



  );



}







function initializeHoneypot(client, config) {



  clientRef = client;



  configRef = config;



  loadData();



}



async function buildWarningEmbed() {



  const cfg = getWarningConfig();







  const embed = new EmbedBuilder()



    .setColor(cfg.color || getBranding().embedColor || '#FF0000')



    .setTitle(`${getEmoji()} ${cfg.title || 'Security Warning'}`.trim())



    .setDescription(



      replace(



        cfg.description ||



        `This channel is protected by ${getServerName()} security.`



      )



    )



    .setTimestamp()



    .setFooter({



      text: `${cfg.footer?.text ? replace(cfg.footer.text) + ' • ' : ''}${INTERNAL_MARKER}`



    });







  if (cfg.author?.name) {



    embed.setAuthor({



      name: replace(cfg.author.name)



    });



  }







  return embed;



}







async function createWarning(channel) {



  try {



    if (!hasPermission(channel, PermissionsBitField.Flags.SendMessages))



      return null;







    const msg = await channel.send({



      embeds: [await buildWarningEmbed()]



    });







    DATA.warningMessageId = msg.id;



    DATA.warningChannelId = channel.id;



    DATA.lastConfigHash = getHash();



    saveData();







    return msg;



  } catch (e) {



    console.error('[Honeypot] Create warning failed:', e.message);



    return null;



  }



}







async function updateWarning(message) {



  try {



    await message.edit({



      embeds: [await buildWarningEmbed()]



    });







    DATA.lastConfigHash = getHash();



    saveData();







    return true;



  } catch (e) {



    console.error('[Honeypot] Update warning failed:', e.message);



    return false;



  }



}







async function manageWarningEmbed() {



  try {



    const channel = await getChannel(



      configRef.honeypot.channelId



    );







    if (!channel?.isTextBased())



      return;







    let warning = null;







    if (DATA.warningMessageId) {



      try {



        const msg = await channel.messages.fetch(



          DATA.warningMessageId



        );







        if (isWarningMessage(msg))



          warning = msg;







      } catch {}



    }







    if (!warning) {



      const messages = await channel.messages.fetch({



        limit: 50



      });







      warning = messages.find(



        m => isWarningMessage(m)



      );







      if (warning) {



        DATA.warningMessageId = warning.id;



        DATA.warningChannelId = channel.id;



        saveData();



      }



    }







    if (!warning) {



      await createWarning(channel);



      return;



    }







    if (DATA.lastConfigHash !== getHash()) {



      await updateWarning(warning);



    }







  } catch (e) {



    console.error('[Honeypot] Manage warning failed:', e.message);



  }



}







async function purgeChannel(channel) {



  if (!configRef.honeypot.purgeOnStartup)



    return;







  if (!hasPermission(



    channel,



    PermissionsBitField.Flags.ManageMessages



  ))



    return;







  try {



    while (true) {



      const messages = await channel.messages.fetch({



        limit: 100



      });







      if (!messages.size)



        break;







      const remove = messages.filter(message => {



        if (message.id === DATA.warningMessageId)



          return false;







        if (message.author?.id === clientRef.user.id)



          return false;







        if (isWarningMessage(message))



          return false;







        return true;



      });







      if (!remove.size)



        break;







      try {



        await channel.bulkDelete(remove, true);



      } catch {



        for (const msg of remove.values()) {



          try {



            await msg.delete();



          } catch {}



        }



      }







      if (messages.size < 100)



        break;



    }







  } catch (e) {



    console.error('[Honeypot] Purge failed:', e.message);



  }



}







async function sendDM(user, action, reason) {



  if (!configRef.honeypot.dmBeforePunishment)



    return;







  try {



    await user.send({



      embeds: [



        new EmbedBuilder()



          .setColor('#FF0000')



          .setTitle(`${getServerName()} Security Action`)



          .setDescription(



            `You have been **${getActionText(action)}** from **${getServerName()}**.\n\n` +



            `**Reason:** ${reason}\n\n` +



            `Appeal: ${getSupportUrl()}`



          )



          .setTimestamp()



          .setFooter({



            text: `${getServerName()} Security System`



          })



      ]



    });



  } catch {}



}

async function sendLog(data) {

  const channel = await getChannel(

    configRef.honeypot.logChannelId

  );



  if (!channel?.isTextBased())

    return;



  const embed = new EmbedBuilder()

    .setTimestamp()

    .setFooter({

      text: `${getServerName()} Security Log`

    });





  if (data.type === 'trigger') {

    embed

      .setColor('#FF0000')

      .setTitle('Honeypot Triggered')

      .setDescription(

        `${data.user} triggered the honeypot system`

      )

      .addFields(

        {

          name: 'User',

          value: `${data.user.tag}\n${data.user.id}`,

          inline: true

        },

        {

          name: 'Action',

          value: getActionText(data.action),

          inline: true

        },

        {

          name: 'Channel',

          value: `<#${data.channel}>`,

          inline: true

        },

        {

          name: 'Message',

          value: truncate(data.content)

        }

      );

  }





  if (data.type === 'error') {

    embed

      .setColor('#FF0000')

      .setTitle('Honeypot Error')

      .setDescription(

        truncate(data.error)

      );

  }





  try {

    await channel.send({

      embeds: [embed]

    });

  } catch {}

}





async function punish(member, message) {

  const cfg = configRef.honeypot;

  const action = cfg.punishment || 'none';

  const reason = 'Triggered honeypot security system';





  if (!canPunish(member))

    return;





  await sendDM(

    member.user,

    action,

    reason

  );





  try {



    if (action === 'ban') {



      if (

        member.guild.members.me.permissions.has(

          PermissionsBitField.Flags.BanMembers

        )

      ) {

        await member.ban({

          reason,

          deleteMessageSeconds: 604800

        });

      }



    } else if (action === 'kick') {



      if (

        member.guild.members.me.permissions.has(

          PermissionsBitField.Flags.KickMembers

        )

      ) {

        await member.kick(reason);

      }



    } else if (action === 'timeout') {



      if (

        member.guild.members.me.permissions.has(

          PermissionsBitField.Flags.ModerateMembers

        )

      ) {

        await member.timeout(

          cfg.timeoutDuration || 3600000,

          reason

        );

      }



    }





    if (

      cfg.deleteTriggerMessage &&

      message.deletable

    ) {

      await message.delete().catch(() => {});

    }





    await sendLog({

      type: 'trigger',

      user: member.user,

      action,

      channel: message.channel.id,

      content: message.content

    });





  } catch (e) {



    await sendLog({

      type: 'error',

      error: e.message

    });



  }

}





async function handleMessage(message) {



  if (!message.guild)

    return;



  if (

    message.guild.id !== configRef.guildId

  )

    return;



  if (

    message.channel.id !==

    configRef.honeypot.channelId

  )

    return;





  if (

    message.author.bot &&

    configRef.honeypot.ignoreBots !== false

  )

    return;





  if (

    message.webhookId &&

    configRef.honeypot.ignoreWebhooks !== false

  )

    return;





  if (

    DATA.processing.includes(

      message.author.id

    )

  )

    return;





  DATA.processing.push(

    message.author.id

  );



  saveData();





  try {



    const member = await getMember(

      message.guild,

      message.author.id

    );



    if (member)

      await punish(member, message);



  } finally {



    setTimeout(() => {



      DATA.processing =

        DATA.processing.filter(

          id => id !== message.author.id

        );



      saveData();



    }, 5000);



  }

}





function registerEvents() {



  clientRef.on(

    'messageCreate',

    handleMessage

  );





  clientRef.on(

    'messageUpdate',

    async (_, message) => {



      if (message.partial) {

        try {

          message = await message.fetch();

        } catch {

          return;

        }

      }



      handleMessage(message);

    }

  );





  clientRef.once(

    'ready',

    async () => {



      console.log(

        `[Honeypot] Online as ${clientRef.user.tag}`

      );





      const channel = await getChannel(

        configRef.honeypot.channelId

      );





      if (!channel)

        return;





      await manageWarningEmbed();





      if (configRef.honeypot.purgeOnStartup)

        await purgeChannel(channel);





      if (configRef.honeypot.recreateWarning) {

        setInterval(

          manageWarningEmbed,

          60000

        );

      }



    }

  );

}





function initialize(client, config) {

  clientRef = client;

  configRef = config;



  loadData();

  registerEvents();

}





module.exports = {

  initialize

};
