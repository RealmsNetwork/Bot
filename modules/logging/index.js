const { EmbedBuilder } = require('discord.js');
async function initialize(client, config) {
  const id = config.logging?.channelId;
  const send = async embed => {
    const channel = client.channels.cache.get(id);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
  };
  client.on('messageDelete', message => {
    if (!message.guild || message.author?.bot) return;
    send(new EmbedBuilder().setTitle('🗑️ Message Deleted').setDescription(`Author: ${message.author}\nChannel: ${message.channel}\n${(message.content || '*no text*').slice(0, 4000)}`).setColor(config.branding.embedColor));
  });
  client.on('guildMemberRemove', member => {
    send(new EmbedBuilder().setTitle('👋 Member Left').setDescription(`${member.user.tag} (${member.id})`).setColor(config.branding.embedColor));
  });
}
module.exports = { initialize };
