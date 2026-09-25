    room.page=kind==='speak'?'tts':'room';
    await interaction.editReply({content:'Updated.'});
    await refresh(client,room,room.page);
  }catch(e){return interaction.editReply({content:'Could not update: '+(e?.message||e)}).catch(()=>{});}
}

async function handle(interaction,client,rooms){
  try{
    if(interaction.isButton?.()&&interaction.customId.startsWith('rn-tvc:'))return await handleButton(interaction,client,rooms);
    if((interaction.isStringSelectMenu?.()||interaction.isUserSelectMenu?.()||interaction.isRoleSelectMenu?.())&&interaction.customId.startsWith('rn-tvc:'))return await handleSelect(interaction,client,rooms);
    if(interaction.isModalSubmit?.()&&interaction.customId.startsWith('rn-tvc-modal:'))return await handleModal(interaction,client,rooms);
  }catch(e){
    console.error('[TempVC/Panel]',e?.stack||e);
    if(interaction.deferred&&!interaction.replied)await interaction.editReply({content:'Panel action failed: '+(e?.message||e)}).catch(()=>{});
    else if(!interaction.replied&&!interaction.deferred)await interaction.reply({content:'Panel action failed: '+(e?.message||e),flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
}

async function recover(client,rooms){
  if(tc(client).panelEnabled===false)return;
  for(const guild of client.guilds.cache.values()){
    const channels=await guild.channels.fetch().catch(()=>guild.channels.cache);
    for(const channel of channels.values()){
      if(!channel?.isTextBased?.()||!channel.topic?.startsWith('RealmsNetwork temporary VC panel | '))continue;
      const owner=channel.topic.match(/owner=(\d+)/)?.[1];
      const voiceId=channel.topic.match(/voice=(\d+)/)?.[1];
      if(!owner||!voiceId)continue;
      const voice=guild.channels.cache.get(voiceId)||await guild.channels.fetch(voiceId).catch(()=>null);
      if(!voice||voice.type!==ChannelType.GuildVoice){await channel.delete('Temporary VC voice channel missing').catch(()=>{});continue;}
      const saved=await client.db?.get?.(guild.id,'tempvc:'+voice.id,null);
      const hasSavedState=saved?.version===1&&/^\d{17,20}$/.test(String(saved.ownerId||''));
      const room={
        guildId:guild.id,voiceChannelId:voice.id,panelChannelId:channel.id,panelMessageId:null,
        ownerId:hasSavedState?String(saved.ownerId):owner,createdAt:channel.createdTimestamp||Date.now(),
        locked:hasSavedState?!!saved.locked:!!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Connect),
        hidden:hasSavedState?!!saved.hidden:!!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel),
        accessUsers:new Set(hasSavedState?Array.isArray(saved.accessUsers)?saved.accessUsers:[]:[owner]),
        accessRoles:new Set(hasSavedState?Array.isArray(saved.accessRoles)?saved.accessRoles:[]:[]),
        bannedUsers:new Set(hasSavedState?Array.isArray(saved.bannedUsers)?saved.bannedUsers:[]:[]),
        page:'overview',
        operatorControls:hasSavedState?saved.operatorControls!==false:tc(client).ownerOnlyControl !== true && tc(client).panelAccessCanControl !== false,
        syncPermissions:hasSavedState?saved.syncPermissions!==false:tc(client).syncPermissions !== false,
        tts:hasSavedState&&saved.tts&&typeof saved.tts==='object'?saved.tts:{},
        ttsBrowser:{kind:null,page:0}
      };
      if(!hasSavedState){
        for(const [id,ow] of channel.permissionOverwrites.cache){
          if(id===guild.roles.everyone.id||id===guild.members.me?.id)continue;
          if(ow.type===0&&ow.allow.has(PermissionFlagsBits.ViewChannel))room.accessRoles.add(id);
          if(ow.type===1&&ow.allow.has(PermissionFlagsBits.ViewChannel))room.accessUsers.add(id);
        }
        for(const [id,ow] of voice.permissionOverwrites.cache){
          if(id===guild.roles.everyone.id||id===guild.members.me?.id||id===owner)continue;
          if(ow.type===1&&ow.deny.has(PermissionFlagsBits.Connect))room.bannedUsers.add(id);
        }
      }
      if(tc(client).autoTransferOnOwnerLeave!==false&&voice.members.size>0&&!voice.guild.members.cache.has(room.ownerId)){
        const next=[...voice.members.values()].filter(member=>!member.user.bot&&!room.bannedUsers.has(member.id)).sort((a,b)=>(a.joinedTimestamp||0)-(b.joinedTimestamp||0))[0];
        if(next){
          room.ownerId=next.id;
          room.accessUsers.add(next.id);
          await voice.permissionOverwrites.edit(next.id,{Connect:true,Speak:true,ViewChannel:true}).catch(()=>{});
          await channel.permissionOverwrites.edit(next.id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
        }
      }
      rooms.set(voice.id,room);
      await refresh(client,room,'overview').catch(()=>{});
    }
  }
}

async function cleanup(client,rooms){
  if(tc(client).autoDeleteEmpty===false)return;
  for(const room of [...rooms.values()]){
    const guild=client.guilds.cache.get(room.guildId);
    if(!guild){rooms.delete(room.voiceChannelId);continue;}
    const voice=guild.channels.cache.get(room.voiceChannelId);
    if(!voice){
      rooms.delete(room.voiceChannelId);
      const panel=room.panelChannelId&&guild.channels.cache.get(room.panelChannelId);
      await panel?.delete('Temporary VC voice channel missing').catch(()=>{});
      continue;
    }
    if(voice.members.size===0)await deleteRoom(client,rooms,room,guild,'Temporary voice room empty');
  }
}

async function channelUpdate(oldChannel,newChannel,client,rooms){
  if(!newChannel?.id||newChannel.type!==ChannelType.GuildVoice)return;
  const room=rooms.get(newChannel.id);
  if(!room)return;