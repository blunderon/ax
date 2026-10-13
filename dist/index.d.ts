import type { Page } from 'playwright-core';
export type AXStates = Record<string, string | number | boolean>;
export interface FindOptions {
    role: string;
    name?: string | RegExp;
    scope?: AXHandle;
    states?: AXStates;
    timeout?: number;
}
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}
export declare function snapshot(page: Page, scope?: AXHandle): Promise<string>;
export declare function find(page: Page, options: FindOptions): Promise<AXHandle>;
export declare class AXHandle {
    readonly page: Page;
    readonly backendNodeId: number;
    constructor(page: Page, backendNodeId: number);
    states(): Promise<AXStates>;
    box(): Promise<Box>;
    private enabled;
    click(options?: Parameters<Page['mouse']['click']>[2]): Promise<void>;
    focus(): Promise<void>;
    type(text: string, options?: Parameters<Page['keyboard']['type']>[1]): Promise<void>;
    press(key: string, options?: Parameters<Page['keyboard']['press']>[1]): Promise<void>;
    dragTo(target: AXHandle, options?: {
        steps?: number;
    }): Promise<void>;
}
