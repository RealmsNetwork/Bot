const fs = require('fs');

const path = require('path');

const yaml = require('js-yaml');



const CONFIG_PATH = path.join(__dirname, 'config.yml');

const CONFIG_EXAMPLE_PATH = path.join(__dirname, 'config.example.yml');



const ENV_PATH = path.join(__dirname, '.env');

const ENV_EXAMPLE_PATH = path.join(__dirname, '.env.example');



function deepMerge(target, source) {

  if (!target || typeof target !== 'object') target = {};



  for (const key of Object.keys(source)) {

    if (

      source[key] &&

      typeof source[key] === 'object' &&

      !Array.isArray(source[key])

    ) {

      target[key] = deepMerge(target[key], source[key]);

    } else if (!(key in target)) {

      target[key] = source[key];

    }

  }



  return target;

}



function updateConfig() {

  try {

    if (!fs.existsSync(CONFIG_EXAMPLE_PATH)) {

      console.log('[Config] config.example.yml missing');

      return;

    }



    const example = yaml.load(

      fs.readFileSync(CONFIG_EXAMPLE_PATH, 'utf8')

    ) || {};



    if (!fs.existsSync(CONFIG_PATH)) {

      fs.writeFileSync(

        CONFIG_PATH,

        yaml.dump(example, {

          noRefs: true,

          lineWidth: -1

        })

      );



      console.log('[Config] Created config.yml');

      return;

    }



    const current = yaml.load(

      fs.readFileSync(CONFIG_PATH, 'utf8')

    ) || {};



    const currentVersion = current.version ?? 0;

    const exampleVersion = example.version ?? currentVersion;



    if (currentVersion !== exampleVersion) {

      console.log(

        `[Config] Updating config ${currentVersion} -> ${exampleVersion}`

      );



      const updated = deepMerge(current, example);

      updated.version = exampleVersion;



      const tempFile = `${CONFIG_PATH}.tmp`;



      fs.writeFileSync(

        tempFile,

        yaml.dump(updated, {

          noRefs: true,

          lineWidth: -1

        })

      );



      fs.renameSync(tempFile, CONFIG_PATH);



      console.log('[Config] Updated successfully');

    }



  } catch (err) {

    console.error('[Config] Update failed:', err.message);

  }

}



function updateEnv() {

  try {

    if (!fs.existsSync(ENV_EXAMPLE_PATH)) {

      console.log('[ENV] .env.example missing');

      return;

    }



    if (!fs.existsSync(ENV_PATH)) {

      fs.copyFileSync(

        ENV_EXAMPLE_PATH,

        ENV_PATH

      );



      console.log('[ENV] Created .env');

      return;

    }



    const current = fs.readFileSync(ENV_PATH, 'utf8');

    const example = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');



    const existingKeys = new Set();



    for (const line of current.split('\n')) {

      const clean = line.trim();



      if (

        clean &&

        !clean.startsWith('#') &&

        clean.includes('=')

      ) {

        existingKeys.add(

          clean.split('=')[0].trim()

        );

      }

    }



    const missing = [];



    for (const line of example.split('\n')) {

      const clean = line.trim();



      if (

        !clean ||

        clean.startsWith('#') ||

        !clean.includes('=')

      ) continue;



      const key = clean.split('=')[0].trim();



      if (!existingKeys.has(key)) {

        missing.push(line);

      }

    }



    if (missing.length) {

      fs.appendFileSync(

        ENV_PATH,

        `\n${missing.join('\n')}\n`

      );



      console.log(

        `[ENV] Added ${missing.length} missing keys`

      );

    }



  } catch (err) {

    console.error('[ENV] Update failed:', err.message);

  }

}



updateConfig();

updateEnv();



require('dotenv').config();



const { Client, GatewayIntentBits, Partials } = require('discord.js');

const CONFIG_PATH = path.join(__dirname, 'config.yml');



let CONFIG;



try {

  const file = fs.readFileSync(CONFIG_PATH, 'utf8');



  CONFIG = yaml.load(file);



  console.log('[Config] Loaded successfully');

} catch (e) {

  console.error('[Config] Failed to load config.yml:', e.message);

  process.exit(1);

}



CONFIG.token = process.env.DISCORD_TOKEN;



if (!CONFIG.token) {

  console.error('[Config] DISCORD_TOKEN not set in .env or environment variables');

  process.exit(1);

}



const client = new Client({

  intents: [

    GatewayIntentBits.Guilds,

    GatewayIntentBits.GuildMessages,

    GatewayIntentBits.MessageContent,

    GatewayIntentBits.GuildMembers,

    GatewayIntentBits.GuildModeration,

    GatewayIntentBits.GuildMessageReactions,

    GatewayIntentBits.DirectMessages,

  ],



  partials: [

    Partials.Channel,

    Partials.Message,

    Partials.GuildMember,

    Partials.User,

  ],

});



// ------------------------------------------------------------------

// DYNAMIC MODULE LOADER

// ------------------------------------------------------------------



function loadModules() {

  const modulesPath = path.join(__dirname, 'modules');



  if (!fs.existsSync(modulesPath)) {

    console.log('[Modules] No modules folder found.');

    return;

  }



  const moduleFolders = fs.readdirSync(modulesPath, {

    withFileTypes: true

  })

    .filter(dirent => dirent.isDirectory())

    .map(dirent => dirent.name);



  for (const moduleName of moduleFolders) {

    const moduleConfig = CONFIG[moduleName];



    if (!moduleConfig || moduleConfig.enabled === false) {

      console.log(

        `[Modules] Skipping "${moduleName}" (disabled or no config)`

      );



      continue;

    }



    const modulePath = path.join(

      modulesPath,

      moduleName,

      'index.js'

    );



    if (!fs.existsSync(modulePath)) {

      console.warn(

        `[Modules] Module "${moduleName}" has no index.js`

      );



      continue;

    }



    try {

      const moduleExports = require(modulePath);



      if (typeof moduleExports.initialize === 'function') {

        moduleExports.initialize(

          client,

          CONFIG

        );



        console.log(

          `[Modules] Loaded "${moduleName}"`

        );



      } else {

        console.warn(

          `[Modules] "${moduleName}" missing initialize()`

        );

      }



    } catch (err) {

      console.error(

        `[Modules] Failed loading "${moduleName}":`,

        err

      );

    }

  }

}



// ------------------------------------------------------------------

// LOAD MODULES

// ------------------------------------------------------------------



loadModules();



module.exports = {

  CONFIG,

  client

};



// ------------------------------------------------------------------

// START BOT

// ------------------------------------------------------------------



if (require.main === module) {

  client.login(CONFIG.token)

    .then(() => {

      console.log('[Bot] Online');

    })

    .catch(err => {

      console.error(

        '[Bot] Login failed:',

        err

      );

    });

}



// ------------------------------------------------------------------

// ERROR HANDLING

// ------------------------------------------------------------------



process.on(

  'unhandledRejection',

  err => console.error('[Unhandled]', err)

);



process.on(

  'uncaughtException',

  err => console.error('[Crash]', err)

);
