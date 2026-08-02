// aichat.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

let clientRef = null;
let configRef = null;
let model = null;
const cooldowns = new Map();

function cooldown(id, time) {
    let now = Date.now();
    let last = cooldowns.get(id);
    if (last && (now - last) < time * 1000) return true;
    cooldowns.set(id, now);
    return false;
}

function truncate(text, max) {
    if (!text) return "";
    return text.length <= max ? text : text.slice(0, max) + "…";
}

async function safeReply(message, text) {
    try {
        if (!message || !text) return;
        await message.reply(text);
    } catch (e) {
        console.error("[AI Reply]", e.message);
    }
}

function startTyping(channel) {
    let stopped = false;
    let timer = null;

    async function typing() {
        if (stopped) return;
        try { await channel.sendTyping(); } catch (e) {}
    }

    typing();
    timer = setInterval(typing, 8000);

    return () => {
        stopped = true;
        if (timer) clearInterval(timer);
    };
}

/**
 * Universal attachment downloader. Allows any file attachment type 
 * (JavaScript, Code, Images, Audio, Video, Docs, Archives, Text logs, etc.)
 */
async function processAttachment(attachment) {
    try {
        const response = await fetch(attachment.url);
        if (!response.ok) return null;

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Data = buffer.toString("base64");

        let mimeType = attachment.contentType;

        // Fallback or explicit mapping for custom/code types if Discord doesn't provide a content type header
        if (!mimeType) {
            const ext = attachment.name?.split('.').pop()?.toLowerCase();
            const customMap = {
                // Code & Scripts
                js: "text/javascript",
                ts: "text/typescript",
                py: "text/x-python",
                html: "text/html",
                css: "text/css",
                json: "application/json",
                xml: "application/xml",
                sql: "application/sql",
                rs: "text/plain",
                go: "text/plain",
                c: "text/plain",
                cpp: "text/plain",
                h: "text/plain",
                java: "text/plain",
                sh: "text/x-sh",
                // Logs & Text
                txt: "text/plain",
                log: "text/plain",
                csv: "text/csv",
                md: "text/markdown",
                // Documents & Archives
                pdf: "application/pdf",
                zip: "application/zip",
                // Media fallbacks
                png: "image/png",
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                webp: "image/webp",
                gif: "image/gif",
                mp3: "audio/mp3",
                wav: "audio/wav",
                ogg: "audio/ogg",
                mp4: "video/mp4",
                webm: "video/webm"
            };
            mimeType = customMap[ext] || "application/octet-stream";
        }

        return {
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        };
    } catch (e) {
        console.error("[AI Attachment Fetch]", e.message);
        return null;
    }
}

async function generate(contents) {
    try {
        if (!model) return null;

        let result = await model.generateContent(contents);
        if (!result) return null;

        let response = await result.response;
        if (!response) return null;

        let text = response.text();
        if (!text || !text.trim()) return null;

        return text.trim();
    } catch (e) {
        console.error("[AI Generate]", e.message);
        return null;
    }
}

async function handleMessage(message) {
    let stopTyping = null;

    try {
        if (!configRef?.aichat) return;
        if (!model) return;
        if (!message) return;
        if (message.author?.bot) return;

        if (message.partial) {
            try { await message.fetch(); } catch (e) { return; }
        }

        if (!message.guild) return;
        if (configRef.guildId && message.guild.id !== configRef.guildId) return;
        if (!configRef.aichat.channelId) return;
        if (message.channelId !== configRef.aichat.channelId) return;

        let content = message.content?.trim() || "";
        const hasAttachments = message.attachments && message.attachments.size > 0;

        if (!content && !hasAttachments) return;

        let cooldownTime = configRef.aichat.cooldownSeconds || 5;
        if (cooldown(message.author.id, cooldownTime)) {
            await safeReply(message, `⏳ Please wait ${cooldownTime}s before asking again.`);
            return;
        }

        content = truncate(content, configRef.aichat.maxInputLength || 2000);

        stopTyping = startTyping(message.channel);

        let geminiParts = [];

        if (content) {
            geminiParts.push(content);
        }

        if (hasAttachments) {
            const maxFiles = configRef.aichat.maxAttachments || 4; 
            let count = 0;

            for (const [_, attachment] of message.attachments) {
                if (count >= maxFiles) break;
                const part = await processAttachment(attachment);
                if (part) {
                    geminiParts.push(part);
                    count++;
                }
            }
        }

        if (geminiParts.length === 0) {
            await safeReply(message, "⚠️ I couldn't read the attached files or text content.");
            return;
        }

        let reply = await generate(geminiParts);

        if (!reply) {
            reply = configRef.aichat.fallbackMessage || "⚠️ I couldn't generate a response right now.";
        }

        await safeReply(message, truncate(reply, 2000));

    } catch (e) {
        console.error("[AI Handler]", e);

        if (message) {
            await safeReply(
                message,
                configRef?.aichat?.errorMessage || "⚠️ Something went wrong while generating a response."
            );
        }

    } finally {
        if (stopTyping) {
            try { stopTyping(); } catch (e) {}
        }
    }
}

function registerEvents() {
    try {
        if (!clientRef) return;

        clientRef.on("messageCreate", async message => {
            try {
                await handleMessage(message);
            } catch (e) {
                console.error("[AI Message Event]", e);
            }
        });

    } catch (e) {
        console.error("[AI Events]", e);
    }
}

function initialize(client, config) {
    try {
        if (!client) {
            console.error("[AI] Missing client");
            return;
        }

        if (!config) {
            console.error("[AI] Missing config");
            return;
        }

        let key = process.env.GEMINI_API_KEY;

        if (!key) {
            console.warn("[AI] GEMINI_API_KEY missing, disabled");
            return;
        }

        if (!config.aichat) {
            console.warn("[AI] aichat config missing, disabled");
            return;
        }

        if (!config.aichat.channelId) {
            console.warn("[AI] aichat.channelId missing, disabled");
            return;
        }

        clientRef = client;
        configRef = config;

        try {
            let genAI = new GoogleGenerativeAI(key);

            model = genAI.getGenerativeModel({
                model: config.aichat.model || "gemini-2.5-flash"
            });

        } catch (e) {
            console.error("[AI Model Init]", e);
            return;
        }

        registerEvents();

        console.log("[AI] aichat loaded with wildcard attachment support (JS, code, docs, media)");

    } catch (e) {
        console.error("[AI Init]", e);
    }
}

module.exports = {
    initialize
};
