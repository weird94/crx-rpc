export interface RuntimeMessageChannel<TMessage = any> {
    sendMessage(message: TMessage): Promise<void>;
    onMessage(handler: (message: TMessage, sender: chrome.runtime.MessageSender) => void | Promise<void>): () => void;
}

export interface TabMessageChannel<TMessage = any> {
    sendMessage(message: TMessage): Promise<void>;
}

export type TabRemovedHandler = (tabId: number, removeInfo?: chrome.tabs.TabRemoveInfo) => void;

export function createRuntimeMessageChannel<TMessage = any>(): RuntimeMessageChannel<TMessage>;

export function createTabMessageChannel<TMessage = any>(tabId: number): TabMessageChannel<TMessage>;

export function onTabRemoved(handler: TabRemovedHandler): () => void;
