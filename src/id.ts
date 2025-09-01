/**
 * Identifier 类型，既携带类型信息，又在运行时能唯一标识。
 */
export interface Identifier<T> {
    key: string;
    __type?: T; // 用于 TS 类型推导，不会出现在运行时
}

/**
 * 创建一个 Identifier。
 * @param key 唯一字符串标识
 */
export function createIdentifier<T>(key: string): Identifier<T> {
    return {
        key,
    } as Identifier<T>;
}
