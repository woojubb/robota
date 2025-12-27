"use client";

import type { IEventService, ILogger } from '@robota-sdk/agents';
import { PlaygroundApp } from '@robota-sdk/playground';
import type { WorkflowEventSubscriber } from '@robota-sdk/workflow';
import { WorkflowSubscriberEventService } from '@robota-sdk/workflow';

export default function PlaygroundPage() {
    const createEventService = (workflowSubscriber: WorkflowEventSubscriber, logger: ILogger): IEventService => {
        return new WorkflowSubscriberEventService(workflowSubscriber, logger);
    };
    return <PlaygroundApp createEventService={createEventService} />;
} 