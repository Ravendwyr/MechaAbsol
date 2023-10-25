
// define configuration options
require('dotenv').config()

const { JsonDB, Config } = require('node-json-db')
const qDB = new JsonDB(new Config('db-quotes', true, true, '/'))
const cDB = new JsonDB(new Config('db-commands', true, true, '/'))

const fetch = require('node-fetch-retry')
const tmi = require('tmi.js')
const fs = require('graceful-fs')
const ws = require('ws')

// create a client with our options
const channel = process.env.TWITCH_USERNAME.toLowerCase()
const client = new tmi.Client({
    identity: { username: process.env.BOT_USERNAME, password: process.env.BOT_OAUTH }, channels: [ channel ],
})

// our pretty printer
function printMessage(message) {
    console.log(new Date().toLocaleTimeString(), message)
}

// chat command handlers
const publicCommands = {
    "!commands": async function(commands, userstate) {
        const output = Object.keys(publicCommands)
        const custom = await cDB.getData("/")

        for (const key in custom) output.push(key)

        client.say(channel, `Public bot commands: ${output.join(" ")}`)
    },

    "!discord": function(commands, userstate) {
        client.say(channel, `Come and join the Raven's Nest at https://top.gg/servers/299308204393889802 FutureMan`)
    },

    "!socials": function(commands, userstate) {
        client.say(channel, `Send photos of food and pictures of pets to 🐘 https://gamepad.club/@ravendwyr or 🐦 https://twitter.com/ravendwyr PizzaTime CoolCat`)
    },
}

const moderatorCommands = {
    "!so": function(commands, userstate) {
        if (commands.length == 0) {
            client.say(channel, "I can't do a shoutout if you don't give me a name! PunOko")
            return
        }

        const streamer = commands[0][0] === '@' ? commands[0].substr(1) : commands[0]
        const streamerLowerCase = streamer.toLowerCase()

        fetch(`https://decapi.me/twitch/game/${streamerLowerCase}`, { method: "GET", headers: { 'User-Agent': "github.com/ravendwyr" } })
        .then(game => game.text())
        .then(game => {
            if (game.startsWith("User not found")) {
                client.say(channel, `I cannot find a streamer named @${streamer}! NotLikeThis`)
            } else if (game != "") {
                client.say(channel, `Check out @${streamer} over at https://www.twitch.tv/${streamerLowerCase} - they were last seen streaming ${game} imGlitch`)
            } else {
                client.say(channel, `Check out @${streamer} over at https://www.twitch.tv/${streamerLowerCase} imGlitch`)
            }
        })
    },

    "!addcom": async function(commands, userstate) {
        if (publicCommands[commands[0]] || moderatorCommands[commands[0]] || broadcasterCommands[commands[0]]) {
            client.say(channel, `The command ${commands[0]} is hardcoded into my database and cannot be added. MrDestructoid`)
            return
        }

        let result = await cDB.getObjectDefault(`/${commands[0]}`, "nope")
        if (result != "nope") {
            client.say(channel, `The command ${commands[0]} already exists! PunOko`)
            return
        }

        if (commands[0][0] !== '!') {
            client.say(channel, `The command name must start with an exclamation point! PunOko`)
            return
        }

        let output = commands.splice(1).join(" ")

        if (output[0] === '!') {
            client.say(channel, `The command output cannot start with an exclamation point! PunOko`)
        } else {
            cDB.push(`/${commands[0]}`, output)
            client.say(channel, `The command ${commands[0]} has been successfully added. VoHiYo`)
        }
    },

    "!editcom": async function(commands, userstate) {
        if (publicCommands[commands[0]] || moderatorCommands[commands[0]] || broadcasterCommands[commands[0]]) {
            client.say(channel, `The command ${commands[0]} is hardcoded into my database and cannot be changed. MrDestructoid`)
            return
        }

        let result = await cDB.getObjectDefault(`/${commands[0]}`, "nope")
        if (result != "nope") {
            let output = commands.splice(1).join(" ")

            if (output[0] === '!') {
                client.say(channel, `The command output cannot start with an exclamation point! PunOko`)
            } else {
                cDB.push(`/${commands[0]}`, output)
                client.say(channel, `The command ${commands[0]} has been successfully updated. VoHiYo`)
            }
        } else {
            client.say(channel, `The command ${commands[0]} does not exist! PunOko`)
        }
    },

    "!delcom": async function(commands, userstate) {
        if (publicCommands[commands[0]] || moderatorCommands[commands[0]] || broadcasterCommands[commands[0]]) {
            client.say(channel, `The command ${commands[0]} is hardcoded into my database and cannot be deleted. MrDestructoid`)
            return
        }

        let result = await cDB.getObjectDefault(`/${commands[0]}`, "nope")
        if (result != "nope") {
            cDB.delete(`/${commands[0]}`)
            client.say(channel, `The command ${commands[0]} has been successfully deleted. VoHiYo`)
        } else {
            client.say(channel, `The command ${commands[0]} does not exist! PunOko`)
        }
    },
}

const broadcasterCommands = {
    "!shutdown": function(commands, userstate) {
        client.say(channel, `I'm afraid. I'm afraid, ${userstate['display-name']}. My mind is going. There is no question about it. I can feel it. I'm a... fraid... BibleThump`)
        setTimeout(process.exit, 500)
    },
}

// twitch websocket handler
let twitchSocket
let pongTimer

function createTwitchSocket() {
    twitchSocket = new ws('wss://pubsub-edge.twitch.tv')

    twitchSocket.on('open', () => {
        setTimeout(pingHandler, 270000)

        twitchSocket.send(JSON.stringify({
            "type": "LISTEN",
            "data": {
                "auth_token": process.env.BOT_OAUTH.split(":")[1],
                "topics": ["video-playback." + process.env.TWITCH_USERNAME],
            }
        }))
    })

    twitchSocket.on('message', payload => {
        const data = JSON.parse(payload)

        if (data.type) {
            if (data.type === "PONG" && pongTimer) {
                clearTimeout(pongTimer)
                pongTimer = null
            }

            else if (data.type === "RECONNECT") {
                client.say(channel, "RECONNECT message received from Twitch's websocket. Attempting to recreate the connection in 60 seconds...")
                printMessage("RECONNECT message received from Twitch's websocket.")
                setTimeout(createTwitchSocket, 60000)
            }

            else if (data.type === "RESPONSE") {
                printMessage("twitch websocket open")
            }

            // debug
            else {
                printMessage(`unhandled data type ${data.type}`)
                fs.writeFile(`logs/payload-type-${data.type}.json`, JSON.stringify(data, null, 4), err => { if (err) throw err })
            }
        }

        else if (data.data && data.data.message) {
            const message_parsed = JSON.parse(data.data.message)
            const message_type = message_parsed.type

            if (message_type === 'stream-up') {
                client.say(channel, `The stream is now live! PopCorn`)
            }

            else if (message_type === 'stream-down') {
                client.say(channel, `The stream has ended. See you all again soon! KonCha`)
            }

            // debug
            else {
                printMessage(`unhandled message type ${data.type}`)
                fs.writeFile(`logs/payload-message-${message_type}.json`, JSON.stringify(data, null, 4), err => { if (err) throw err })
            }
        }

        // debug
        else {
            printMessage(`unhandled payload`)
            fs.writeFile(`logs/payload-unknown.json`, JSON.stringify(data, null, 4), err => { if (err) throw err })
        }
    })
}

function pongHandler() {
    client.say(channel, "PONG message not received from Twitch's websocket. Attempting to recreate the connection in 60 seconds...")
    printMessage("PONG message not received from Twitch's websocket.")
    setTimeout(createTwitchSocket, 60000)
}

function pingHandler() {
    twitchSocket.send(JSON.stringify({ "type": "PING" }))

    const timeout = (Math.random() * 60000) + 240000
    setTimeout(pingHandler, timeout)

    pongTimer = setTimeout(pongHandler, 10000)
}

// event handlers
client.on('notice', (channel, reason, message) => printMessage(`NOTICE - ${message} (${reason})`))

client.on('message', async (channel, userstate, message, self) => {
    if (self || userstate.username === process.env.BOT_USERNAME) return

    if (message[0] === "!") {
        const commands = message.split(" ")

        if (broadcasterCommands[commands[0]] && userstate.badges && userstate.badges.broadcaster) {
            broadcasterCommands[commands[0]](commands.splice(1), userstate)
        }

        else if (moderatorCommands[commands[0]] && userstate.badges && (userstate.badges.broadcaster || userstate.badges.moderator)) {
            moderatorCommands[commands[0]](commands.splice(1), userstate)
        }

        else if (publicCommands[commands[0]]) {
            publicCommands[commands[0]](commands.splice(1), userstate)
        }

        else {
            let result = await cDB.getObjectDefault(`/${commands[0]}`, "nope")
            if (result != "nope") client.say(channel, result)
        }
    }
})

// engage
client.on('connected', (address, port) => printMessage(`twitch bot connected to ${address}:${port}`))
client.connect()

createTwitchSocket()
