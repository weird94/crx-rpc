import { createRuntimeMessageChannel, createTabMessageChannel } from '@webext-core/messaging';
import { RPCClient } from '../client';
import { Disposable } from '../disposable';
import type { IMessageAdapter } from '../types';

export class TabMessageAdapter extends Disposable implements IMessageAdapter {
    private runtimeChannel = createRuntimeMessageChannel<any>();
    private tabChannel: ReturnType<typeof createTabMessageChannel>;

    constructor(private tabId: number) {
        super();
        this.tabChannel = createTabMessageChannel<any>(tabId);
    }

    onMessage<T>(type: string, callback: (message: T) => void): () => void {
        const handler = (msg: { type?: string } & T, sender: chrome.runtime.MessageSender) => {
            if (sender.tab?.id !== this.tabId) return;
            if (msg.type !== type) return;
            callback(msg);
        };

        const dispose = this.runtimeChannel.onMessage(handler);

        this.disposeWithMe(dispose);

        return () => {
            dispose();
        };
    }

    sendMessage<T>(type: string, message: T): void {
        const payload = { ...message, type } as T & { type: string };
        this.tabChannel.sendMessage(payload).catch((error) => {
            console.warn('Failed to send RPC message to tab', this.tabId, error);
        });
    }
}

export class TabRPCClient extends RPCClient {
    private adapter: TabMessageAdapter;

    constructor(tabId: number) {
        const adapter = new TabMessageAdapter(tabId);
        super(adapter);
        this.adapter = adapter;
        this.disposeWithMe(() => this.adapter.dispose());
    }
}

