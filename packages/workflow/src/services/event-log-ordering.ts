import type { IOwnerPathSegment } from '@robota-sdk/agents';

export interface IEventOrderingRecord {
    ownerPath: IOwnerPathSegment[];
    timestamp: Date;
    eventName: string;
    sequenceId?: number;
}

function compareOwnerPath(left: IOwnerPathSegment[], right: IOwnerPathSegment[]): number {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftSegment = left[index];
        const rightSegment = right[index];
        if (!leftSegment || !rightSegment) {
            continue;
        }
        if (leftSegment.type < rightSegment.type) return -1;
        if (leftSegment.type > rightSegment.type) return 1;
        if (leftSegment.id < rightSegment.id) return -1;
        if (leftSegment.id > rightSegment.id) return 1;
    }
    return left.length - right.length;
}

export function compareEventOrdering(left: IEventOrderingRecord, right: IEventOrderingRecord): number {
    const ownerPathOrder = compareOwnerPath(left.ownerPath, right.ownerPath);
    if (ownerPathOrder !== 0) {
        return ownerPathOrder;
    }

    const timestampOrder = left.timestamp.getTime() - right.timestamp.getTime();
    if (timestampOrder !== 0) {
        return timestampOrder;
    }

    if (left.eventName < right.eventName) return -1;
    if (left.eventName > right.eventName) return 1;

    if (typeof left.sequenceId === 'number' && typeof right.sequenceId === 'number') {
        return left.sequenceId - right.sequenceId;
    }

    return 0;
}
