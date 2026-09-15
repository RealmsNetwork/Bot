async function initialize(client,config){client.on('guildMemberAdd',async member=>{const roleId=config.autorole?.roleId;if(!roleId)return;const role=member.guild.roles.cache.get(roleId);if(role&&role.position<member.guild.members.me.roles.highest.position)await member.roles.add(role,'Configured autorole').catch(()=>{});});}
module.exports={initialize};
