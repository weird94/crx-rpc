export interface IRPCService {
    __type: 'content' | 'background'
}

export class ContentService implements IRPCService {
    __type = 'content' as const
}

export class backgroundService implements IRPCService {
    __type = 'background' as const
}