import WAWebJS from "whatsapp-web.js";
import { client } from "./ConnectWhatsapp";
import { Flow } from "../models/Flow";
import { User } from "../models/User";
import { MenuTracker } from "../models/MenuTracker";
import { FlowNode } from "../types/flow.types";

export const ControlMessage = async (msg: WAWebJS.Message) => {
    try {
        if (client) {
            const from = await client.getNumberId(msg.from);
            const me = await client.getNumberId(msg.to);
            let tracker = await MenuTracker.findOne({ phone_number: from?._serialized }).populate('flow')
            if (!tracker) {
                let user = await User.findOne({ connected_number: String(msg.to).replace("@c.us", "") })
                let flows = await Flow.find({ created_by: user })
                if (flows.length > 0) {
                    let flow = flows.find(flow => {
                        let keys = flow.trigger_keywords.split(",");
                        let key = keys.find(key => key === msg.body)
                        if (key) {
                            return flow
                        }
                        return undefined
                    })
                    if (flow && from) {
                        let parent = flow.nodes.find(node => node.parentNode === "start")
                        if (parent) {
                            let sendingNodes = flow.nodes.filter((node) => { return node.parentNode === parent?.id })
                            sendingNodes.forEach(async (node) => {
                                await client?.sendMessage(from._serialized, node.data.media_value)
                            })
                            await client?.sendMessage(from._serialized, "0 for main menu")
                            await new MenuTracker({
                                menu_id: flow.nodes.find(node => node.parentNode === "start")?.id,
                                phone_number: String(from._serialized),
                                joined_at: new Date(),
                                last_active: new Date(),
                                flow: flow
                            }).save()
                        }
                    }
                }
            }
            if (tracker && from) {
                let parent = tracker.flow.nodes.find((node) => node.id === tracker?.menu_id)
                if (msg.body === "0") {
                    let node = tracker?.flow.nodes.find((node) => node.parentNode === "start")
                    if (node) {
                        tracker.menu_id = node.id
                        await tracker.save()
                    }
                }
                if (parent) {
                    let sendingNodes = tracker.flow.nodes.filter((node) => { return node.parentNode === parent?.id })
                    let targetNode = sendingNodes.filter((node) => {
                        let index = String(node.data.index)
                        if (index === msg.body) {
                            return node
                        }
                        return undefined
                    })[0]

                    if (targetNode) {
                        let childNodes: FlowNode[] | undefined = tracker.flow.nodes.filter((node) => { return node.parentNode === targetNode?.id })
                        console.log(childNodes)
                        let childOutputNodes = childNodes.filter((node) => { return node.type === "OutputNode" })
                        console.log(childOutputNodes)

                        let childMenuNodes = childNodes.filter((node) => { return node.type === "MenuNode" })
                        console.log(childMenuNodes)

                        if (childMenuNodes.length > 0) {
                            let menuNode = childMenuNodes[0]
                            if (menuNode) {
                                let sendingNodes = tracker.flow.nodes.filter((node) => { return node.parentNode === menuNode.id })
                                sendingNodes.sort(function (a, b) {
                                    var keyA = new Date(a.data.index),
                                        keyB = new Date(b.data.index);
                                    // Compare the 2 dates
                                    if (keyA < keyB) return -1;
                                    if (keyA > keyB) return 1;
                                    return 0;
                                });
                                sendingNodes.forEach(async (node) => {
                                    await client?.sendMessage(from._serialized, node.data.media_value)
                                })
                                await client?.sendMessage(from._serialized, "0 for main menu")
                                tracker.menu_id = menuNode.id
                                await tracker.save()
                            }
                        }
                        if (childOutputNodes.length > 0) {
                            childOutputNodes?.forEach(async (node) => {
                                await client?.sendMessage(from._serialized, node.data.media_value)
                            })
                        }
                    }
                }
            }
        }
    }
    catch (err) {
        console.log(err)
    }
}