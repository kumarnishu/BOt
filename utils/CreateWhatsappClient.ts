import { Server } from "socket.io";
import { Client, LocalAuth, Message } from "whatsapp-web.js";
import { ControlMessage } from "./ControlMessage";
import { User } from "../models/User";
import { KeywordTracker } from "../models/KeywordTracker";
import { MenuTracker } from "../models/MenuTracker";
const fs = require("fs")
import cron from "cron";

let clients: { client_id: string, client: Client }[] = []
export let users: { id: string }[] = []

export function userJoin(id: string) {
    let user = { id }
    users.push(user)
    return user
}

export function getCurrentUser(id: string) {
    return users.find(user => user.id === id)
}

export function userLeave(id: string) {
    const index = users.findIndex(user => user.id === id)
    if (index !== -1)
        return users.splice(index, 1)[0]
}


export async function createWhatsappClient(client_id: string, client_data_path: string, io: Server) {
    console.log("getting session")
    let oldClient = clients.find((client) => client.client_id === client_id)
    if (oldClient) {
        oldClient.client.destroy()
    }

    let client = new Client({
        authStrategy: new LocalAuth({
            clientId: client_id,
            dataPath: `./.browsers/${client_data_path}`
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        }
    });

    client.on("ready", async () => {
        if (client.info.wid.user) {
            io.to(client_id).emit("ready", client.info.wid.user)
            let user = await User.findOne({
                connected_number: client.info.wid._serialized
            })
            if (!user)
                user = await User.findOne({ client_id: client_id })
            if (user) {
                await User.findByIdAndUpdate(user._id, {
                    is_whatsapp_active: true,
                    connected_number: client?.info.wid._serialized
                })
            }
        }
        if (!clients.find((client) => client.client_id === client_id))
            clients.push({ client_id: client_id, client: client })
        console.log("session revived for", client.info)
    })
    try {
        client.on('disconnected', async (reason) => {
            console.log("reason", reason)
            io.to(client_id).emit("disconnected_whatsapp", client_id)
            let user = await User.findOne({ connected_number: client.info.wid._serialized })
            if (user) {
                await User.findByIdAndUpdate(user._id, {
                    is_whatsapp_active: false,
                    connected_number: null
                })
            }
            clients = clients.filter((client) => { return client.client_id === client_id })
            fs.rmSync(`.browsers/${client_id}`, { recursive: true, force: true })
            console.log("disconnected", client.info)
        })
    }
    catch (err) {
        console.log(err)
    }
    client.on('qr', async (qr) => {
        io.to(client_id).emit("qr", qr);
        clients = clients.filter((client) => { return client.client_id === client_id })
        console.log("logged out", qr, client_id)
    });
    client.on('loading_screen', async (qr) => {
        io.to(client_id).emit("loading");
        console.log("loading", client_id)
    });
    client.on('message', async (msg: Message) => {
        if (client) {
            await ControlMessage(client, msg)
        }
    });

    client.on('message_ack', async (data) => {
        //@ts-ignore
        if (data.ack === 2 && data._data.self === "in") {
            await handleBot(data)
        }
    })
    await client.initialize();

}


async function handleBot(data: Message) {
    let trackers = await KeywordTracker.find({ phone_number: data.to, bot_number: data.from })
    let menuTrackers = await MenuTracker.find({ phone_number: data.to, bot_number: data.from })
    let createCronJob = false
    trackers.forEach(async (tracker) => {
        if (tracker.is_active) {
            createCronJob = true
            await KeywordTracker.findByIdAndUpdate(tracker._id, { is_active: false })
        }
    })
    menuTrackers.forEach(async (tracker) => {
        if (tracker.is_active) {
            createCronJob = true
            await MenuTracker.findByIdAndUpdate(tracker._id, { is_active: false })
        }
    })
    //cron job to restart
    if (createCronJob) {
        let time = new Date(new Date().getTime() + 5 * 60 * 60 * 1000)
        // let time = new Date(new Date().getTime() + 60 * 1000)
        new cron.CronJob(time, async () => {
            console.log('running cron job')
            trackers.forEach(async (tracker) => {
                await KeywordTracker.findByIdAndUpdate(tracker._id, { is_active: true })
            })
            menuTrackers.forEach(async (tracker) => {
                await MenuTracker.findByIdAndUpdate(tracker._id, { is_active: true })
            })
        }).start()
    }
}