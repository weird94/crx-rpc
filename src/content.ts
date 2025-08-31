import { OBSERVABLE_EVENT, RPC_EVENT_NAME, RPC_RESPONSE_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE } from './const';
import type { RpcRequest, RpcResponse, } from './types';

const WEB_TO_BACKGROUND = [RPC_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE]
const BACKGROUND_TO_WEB = [RPC_RESPONSE_EVENT_NAME, OBSERVABLE_EVENT]

export class ContentRPC {
    constructor() {
        WEB_TO_BACKGROUND.forEach(eventName => {
            window.addEventListener(eventName, (event: any) => {
                chrome.runtime.sendMessage({ ...event.detail, type: eventName });
            });
        });

        chrome.runtime.onMessage.addListener((msg: { type: string } & (RpcRequest | RpcResponse), sender) => {
            if (!BACKGROUND_TO_WEB.includes(msg.type)) return;
            const { type, ...detail } = msg
            window.dispatchEvent(new CustomEvent(type, { detail }));
        });
    }
}


